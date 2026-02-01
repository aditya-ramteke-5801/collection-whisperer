"""
Collections Analytics Assistant
A Streamlit app that lets non-technical users query borrower/loan data using plain English.
"""

import os
import pandas as pd
import streamlit as st
from openai import OpenAI
from datetime import datetime
from io import BytesIO

# =============================================================================
# DATA LOADING AND PROCESSING
# =============================================================================

@st.cache_data
def load_and_process_data(file_path: str) -> pd.DataFrame:
    """
    Load data from CSV/Excel file and calculate derived columns.
    Cached to avoid reloading on every rerun.
    """
    # Load data - detect format from extension
    if file_path.endswith('.csv'):
        df = pd.read_csv(file_path, encoding='latin-1', low_memory=False)
    else:
        df = pd.read_excel(file_path)

    # Clean embedded newlines from string columns (especially remarks fields)
    # This ensures row counts match between pandas and Excel
    for col in df.columns:
        if df[col].dtype == 'object':
            df[col] = df[col].astype(str).str.replace('\n', ' ', regex=False)
            df[col] = df[col].str.replace('\r', ' ', regex=False)
            df[col] = df[col].replace('nan', pd.NA)

    # Parse date columns - identify columns with 'date' in name (case-insensitive)
    date_columns = [col for col in df.columns if 'date' in col.lower()]
    for col in date_columns:
        df[col] = pd.to_datetime(df[col], errors='coerce')

    # Map "Resolution amount" to "Collected Amount" for consistency
    # In this dataset, "Resolution amount" represents actual collections
    if 'Resolution amount' in df.columns:
        df['Collected Amount'] = df['Resolution amount'].fillna(0)
    elif 'Collected Amount' not in df.columns:
        df['Collected Amount'] = 0

    # Map "Principal Balance Amount" to "POS" for consistency
    # In this dataset, "Principal Balance Amount" represents AUM (Assets Under Management)
    if 'Principal Balance Amount' in df.columns:
        df['POS'] = df['Principal Balance Amount'].fillna(0)
    elif 'Allocation amount' in df.columns:
        df['POS'] = df['Allocation amount'].fillna(0)
    elif 'POS' not in df.columns or df['POS'].isna().all():
        df['POS'] = df.get('Amount Pending', 0)

    # Convert call-related columns to numeric
    call_columns = ['Call Sent count', 'Call Delivered count', 'Calls Attempted Yesterday', 'Calls Delivered Yesterday']
    for col in call_columns:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)

    # Calculate Conversion Rate = (Collected Amount / POS) * 100
    # Handle division by zero by replacing with 0
    df['Conversion Rate'] = df.apply(
        lambda row: (row['Collected Amount'] / row['POS'] * 100)
        if pd.notna(row['POS']) and row['POS'] != 0
        else 0,
        axis=1
    )

    # Calculate POS Band
    def get_pos_band(pos):
        if pd.isna(pos):
            return 'Unknown'
        elif pos < 10000:
            return '<10K'
        elif pos < 20000:
            return '10K+'
        elif pos < 30000:
            return '20K+'
        elif pos < 40000:
            return '30K+'
        else:
            return '40K+'

    df['POS Band'] = df['POS'].apply(get_pos_band)

    return df


def get_column_descriptions(df: pd.DataFrame) -> str:
    """Generate column descriptions for the LLM prompt."""
    descriptions = []
    for col in df.columns:
        dtype = str(df[col].dtype)
        sample = df[col].dropna().iloc[0] if not df[col].dropna().empty else 'N/A'
        # Truncate long samples
        sample_str = str(sample)[:50] + '...' if len(str(sample)) > 50 else str(sample)
        descriptions.append(f"- {col} ({dtype}): e.g., {sample_str}")
    return "\n".join(descriptions)


def build_system_prompt(df: pd.DataFrame) -> str:
    """
    Build the system prompt for the LLM with all necessary context.
    """
    # Get column descriptions
    column_info = get_column_descriptions(df)

    # Get sample data (first 3 rows as dict)
    sample_data = df.head(3).to_dict(orient='records')

    # Get unique regions if available
    regions = list(df['Region'].unique()) if 'Region' in df.columns else []

    system_prompt = f"""You are a pandas code generator for a loan collections analytics system.
Your job is to convert natural language queries into executable pandas code.

## Available DataFrame: `df`
The DataFrame has {len(df)} rows and the following columns:

{column_info}

## Sample Data (first 3 rows):
{sample_data}

## Key Metrics and Terminology:
- **DPD (Days Past Due)**: Number of days a payment is overdue
- **POS (Principal Outstanding)**: Remaining loan amount to be collected. Also called AUM.
- **AUM (Assets Under Management)**: Same as POS = sum of all POS values. Use column name "AUM" in output.
- **MTD Collection**: Month-to-date collection = Collected Amount. Use column name "MTD Collection" in output.
- **Conversion Rate**: Collection efficiency = (MTD Collection / AUM) * 100. Higher is better.
- **MTD (Month to Date)**: Data from the 1st of current month to today
- **DPD Buckets**: Typically categorized as 0, 1-30, 31-60, 61-90, 90+
- **POS Band**: Loan size categories: <10K, 10K+, 20K+, 30K+, 40K+
- **Regions in India**: North, South, East, West
- **Total Cases**: Count of loans/rows in each group
- **Avg Attempts**: Average of "Call Sent count" column per group
- **Avg Connect**: Average of "Call Delivered count" column per group
- Available Regions in data: {regions}

## Output Column Naming:
- Always rename 'POS' to 'AUM' in output
- Always rename 'Collected Amount' to 'MTD Collection' in output
- Include 'Total Cases' (count) when showing breakdowns
- Include 'Avg Attempts' and 'Avg Connect' when relevant to the query

## Critical Rules:
1. Return ONLY executable pandas code - no explanations, no markdown backticks
2. The code must produce a DataFrame named `result`
3. The input DataFrame is called `df`
4. For "conversion" calculations, ALWAYS use: (Collected Amount sum / POS sum) * 100
5. Always include appropriate aggregations (sum, mean, count) based on context
6. Sort results meaningfully by the main metric being asked about
7. Round percentage values to 2 decimal places
8. For MTD queries, filter where date column >= first day of current month
9. When grouping by Agent Name, include an "Unassigned" row for data where Agent Name is null/empty
10. **MANDATORY**: EVERY query that groups data MUST have a "Grand Total" row at the END:
    - This applies to ALL groupby queries (Region, POS Band, DPD Bucket, State, Agent, etc.)
    - Create the Grand Total row AFTER sorting the main results
    - Use pd.concat to append Grand Total as the LAST row
    - Grand Total must sum numeric columns and recalculate rates from totals
    - NO EXCEPTIONS - every grouped result needs Grand Total

## Example Queries and Expected Code:

Query: "lowest conversion by POS band" or "POS band breakup"
Code:
result = df.groupby('POS Band').agg({{'Loan Number': 'count', 'POS': 'sum', 'Collected Amount': 'sum', 'Call Sent count': 'mean', 'Call Delivered count': 'mean'}}).reset_index()
result.columns = ['POS Band', 'Total Cases', 'AUM', 'MTD Collection', 'Avg Attempts', 'Avg Connect']
result['Conversion Rate'] = (result['MTD Collection'] / result['AUM'] * 100).round(2)
result = result.sort_values('Conversion Rate', ascending=False)
grand_total = pd.DataFrame([{{'POS Band': 'Grand Total', 'Total Cases': result['Total Cases'].sum(), 'AUM': result['AUM'].sum(), 'MTD Collection': result['MTD Collection'].sum(), 'Avg Attempts': result['Avg Attempts'].mean().round(2), 'Avg Connect': result['Avg Connect'].mean().round(2), 'Conversion Rate': (result['MTD Collection'].sum() / result['AUM'].sum() * 100).round(2)}}])
result = pd.concat([result, grand_total], ignore_index=True)

Query: "highest conversion region"
Code:
result = df.groupby('Region').agg({{'Collected Amount': 'sum', 'POS': 'sum'}}).reset_index()
result['Conversion Rate'] = (result['Collected Amount'] / result['POS'] * 100).round(2)
result = result.sort_values('Conversion Rate', ascending=False)
grand_total = pd.DataFrame([{{'Region': 'Grand Total', 'Collected Amount': result['Collected Amount'].sum(), 'POS': result['POS'].sum(), 'Conversion Rate': (result['Collected Amount'].sum() / result['POS'].sum() * 100).round(2)}}])
result = pd.concat([result, grand_total], ignore_index=True)

Query: "region wise collection breakup by POS band"
Code:
result = df.groupby(['Region', 'POS Band']).agg({{'Collected Amount': 'sum', 'POS': 'sum'}}).reset_index()
result['Conversion Rate'] = (result['Collected Amount'] / result['POS'] * 100).round(2)
result = result.sort_values(['Region', 'Collected Amount'], ascending=[True, False])

Query: "MTD collection by state"
Code:
from datetime import datetime
current_month_start = datetime.now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
mtd_df = df[df['Upload Date'] >= current_month_start]
result = mtd_df.groupby('State').agg({{'Collected Amount': 'sum'}}).reset_index()
result = result.sort_values('Collected Amount', ascending=False)

Query: "DPD bucket wise conversion" or "DPD bucket breakup"
Code:
result = df.groupby('DPD Bucket').agg({{'Collected Amount': 'sum', 'POS': 'sum'}}).reset_index()
result['Conversion Rate'] = (result['Collected Amount'] / result['POS'] * 100).round(2)
result = result.sort_values('Conversion Rate', ascending=False)
grand_total = pd.DataFrame([{{'DPD Bucket': 'Grand Total', 'Collected Amount': result['Collected Amount'].sum(), 'POS': result['POS'].sum(), 'Conversion Rate': (result['Collected Amount'].sum() / result['POS'].sum() * 100).round(2)}}])
result = pd.concat([result, grand_total], ignore_index=True)

Query: "which states have conversion below 1%"
Code:
state_conv = df.groupby('State').agg({{'Collected Amount': 'sum', 'POS': 'sum'}}).reset_index()
state_conv['Conversion Rate'] = (state_conv['Collected Amount'] / state_conv['POS'] * 100).round(2)
result = state_conv[state_conv['Conversion Rate'] < 1].sort_values('Conversion Rate', ascending=True)

Query: "top 5 agents by collection"
Code:
result = df.groupby('Agent Name').agg({{'Collected Amount': 'sum', 'POS': 'sum'}}).reset_index()
result = result.sort_values('Collected Amount', ascending=False).head(5)
result['Conversion Rate'] = (result['Collected Amount'] / result['POS'] * 100).round(2)
unassigned_data = df[df['Agent Name'].isna() | (df['Agent Name'].astype(str) == 'nan')]
unassigned_row = pd.DataFrame([{{'Agent Name': 'Unassigned', 'Collected Amount': unassigned_data['Collected Amount'].sum(), 'POS': unassigned_data['POS'].sum(), 'Conversion Rate': (unassigned_data['Collected Amount'].sum() / unassigned_data['POS'].sum() * 100).round(2) if unassigned_data['POS'].sum() > 0 else 0}}])
grand_total = pd.DataFrame([{{'Agent Name': 'Grand Total', 'Collected Amount': df['Collected Amount'].sum(), 'POS': df['POS'].sum(), 'Conversion Rate': (df['Collected Amount'].sum() / df['POS'].sum() * 100).round(2)}}])
result = pd.concat([result, unassigned_row, grand_total], ignore_index=True)

Query: "compare East vs West collection"
Code:
filtered_df = df[df['Region'].isin(['East', 'West'])]
result = filtered_df.groupby('Region').agg({{'Collected Amount': 'sum', 'POS': 'sum', 'Loan Number': 'count'}}).reset_index()
result['Conversion Rate'] = (result['Collected Amount'] / result['POS'] * 100).round(2)
result = result.rename(columns={{'Loan Number': 'Loan Count'}})

Now generate pandas code for the user's query. Return ONLY the code, nothing else."""

    return system_prompt


# =============================================================================
# LLM INTEGRATION
# =============================================================================

def query_llm(user_query: str, system_prompt: str) -> str:
    """
    Send query to OpenAI GPT-4 and get pandas code back.
    """
    api_key = "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"

    client = OpenAI(api_key=api_key)

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_query}
        ],
        temperature=0,
        max_tokens=10000
    )

    return response.choices[0].message.content.strip()


# =============================================================================
# QUERY EXECUTION
# =============================================================================

def execute_pandas_code(code: str, df: pd.DataFrame) -> pd.DataFrame:
    """
    Execute LLM-generated pandas code in a controlled namespace.
    Returns the result DataFrame.
    """
    # Clean the code - remove markdown backticks if present
    code = code.replace('```python', '').replace('```', '').strip()

    # Create controlled namespace with only df and pd
    namespace = {
        'df': df.copy(),
        'pd': pd,
        'datetime': datetime
    }

    # Execute the code
    exec(code, namespace)

    # Get the result
    if 'result' not in namespace:
        raise ValueError("Generated code did not produce a 'result' DataFrame")

    result = namespace['result']

    if not isinstance(result, pd.DataFrame):
        # If result is a Series, convert to DataFrame
        if isinstance(result, pd.Series):
            result = result.to_frame()
        else:
            raise ValueError("Result is not a DataFrame")

    return result


# =============================================================================
# UI HELPERS
# =============================================================================

def style_dataframe(df: pd.DataFrame) -> pd.io.formats.style.Styler:
    """
    Apply conditional formatting to the result DataFrame.
    - Conversion/% columns: Green gradient (higher = darker)
    - Collection/Amount columns: Blue gradient
    """
    # Identify columns to format
    conversion_cols = [col for col in df.columns
                       if 'conversion' in col.lower() or '%' in col.lower() or 'rate' in col.lower()]
    amount_cols = [col for col in df.columns
                   if 'collection' in col.lower() or 'amount' in col.lower() or 'pos' in col.lower()]

    # Create styler
    styler = df.style

    # Apply green gradient to conversion columns
    for col in conversion_cols:
        if col in df.columns and df[col].dtype in ['float64', 'int64']:
            styler = styler.background_gradient(subset=[col], cmap='Greens')

    # Apply blue gradient to amount columns
    for col in amount_cols:
        if col in df.columns and df[col].dtype in ['float64', 'int64']:
            styler = styler.background_gradient(subset=[col], cmap='Blues')

    # Format numbers
    styler = styler.format(precision=2, thousands=',')

    return styler


def export_to_excel(df: pd.DataFrame) -> BytesIO:
    """Export DataFrame to Excel file in memory."""
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Query Results')
    output.seek(0)
    return output


# =============================================================================
# MAIN APP
# =============================================================================

def main():
    # Page config
    st.set_page_config(
        page_title="Analytics Assistant",
        page_icon="🧑🏻‍💻",
        layout="wide"
    )

    st.title("🧑🏻‍💻 Collections Whisperer")
    st.caption("Ask me questions in plain English & I'll get you what you want. At least I'll try 😉")

    # Initialize session state
    if 'query_history' not in st.session_state:
        st.session_state.query_history = []
    if 'last_result' not in st.session_state:
        st.session_state.last_result = None
    if 'current_query' not in st.session_state:
        st.session_state.current_query = None

    # Load data
    data_file = "/Users/aditya/Documents/DPDzero/Slice Performance Jan 2025.csv"

    try:
        with st.spinner("Loading data..."):
            df = load_and_process_data(data_file)
    except FileNotFoundError:
        st.error(f"Data file '{data_file}' not found. Please ensure the file exists in the app directory.")
        st.stop()
    except Exception as e:
        st.error(f"Error loading data: {str(e)}")
        st.stop()

    # Build system prompt once data is loaded
    system_prompt = build_system_prompt(df)

    # ==========================================================================
    # SIDEBAR
    # ==========================================================================
    with st.sidebar:
        st.header("📈 Data Overview")

        # Basic stats
        st.metric("Total Records", f"{len(df):,}")

        # Date range if date columns exist
        date_cols = [col for col in df.columns if 'date' in col.lower()]
        if date_cols and 'Upload Date' in df.columns:
            min_date = df['Upload Date'].min()
            max_date = df['Upload Date'].max()
            if pd.notna(min_date) and pd.notna(max_date):
                st.text(f"Date Range: {min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')}")

        # Regions available
        if 'Region' in df.columns:
            regions = df['Region'].dropna().unique().tolist()
            st.text(f"Regions: {', '.join(map(str, regions))}")

        # States count
        if 'State' in df.columns:
            state_count = df['State'].nunique()
            st.text(f"States: {state_count}")

        st.divider()

        # Query history
        st.header("🕐 Last 10 Queries")

        if st.session_state.query_history:
            for i, query in enumerate(st.session_state.query_history):
                # Create a button for each past query
                if st.button(query[:50] + "..." if len(query) > 50 else query,
                            key=f"history_{i}",
                            use_container_width=True):
                    st.session_state.current_query = query
                    st.rerun()
        else:
            st.caption("No queries yet. Ask a question below!")

        st.divider()

        # Sample queries
        st.header("💡 Try These Queries")
        sample_queries = [
            "Show conversion rate by region",
            "Top 5 agents by collection",
            "DPD bucket wise conversion",
            "State wise collection in South region",
            "Lowest performing POS bands"
        ]
        for sample in sample_queries:
            if st.button(sample, key=f"sample_{sample}", use_container_width=True):
                st.session_state.current_query = sample
                st.rerun()

    # ==========================================================================
    # MAIN AREA
    # ==========================================================================

    # Display last result if exists
    if st.session_state.last_result is not None:
        result_df = st.session_state.last_result

        # Show result count
        st.success(f"Found {len(result_df)} results")

        # Display styled dataframe
        st.dataframe(
            style_dataframe(result_df),
            use_container_width=True,
            hide_index=True
        )

        # Download button
        col1, col2, col3 = st.columns([1, 1, 3])
        with col1:
            excel_data = export_to_excel(result_df)
            st.download_button(
                label="📥 Download Excel",
                data=excel_data,
                file_name=f"query_result_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )

    # Process query if one is pending
    if st.session_state.current_query:
        query = st.session_state.current_query
        st.session_state.current_query = None  # Clear the pending query

        with st.spinner("Analyzing your query..."):
            try:
                # Get pandas code from LLM
                generated_code = query_llm(query, system_prompt)

                # Execute the code
                result = execute_pandas_code(generated_code, df)

                # Store result
                st.session_state.last_result = result

                # Add to history (keep last 10)
                if query not in st.session_state.query_history:
                    st.session_state.query_history.insert(0, query)
                    st.session_state.query_history = st.session_state.query_history[:10]

                # Rerun to display results
                st.rerun()

            except ValueError as e:
                st.error(f"API error: {str(e)}")
            except Exception as e:
                st.error(f"Query failed: {str(e)}")

    # Chat input at the bottom
    st.divider()
    user_input = st.chat_input("Go ahead, ask me anything...")

    if user_input:
        st.session_state.current_query = user_input
        st.rerun()


if __name__ == "__main__":
    main()
