"""
Collections Analytics Assistant
A Streamlit app that lets non-technical users query borrower/loan data using plain English.
Features a two-step UX: preview output structure and logic, then run.
"""

import os
import json
import textwrap
import pandas as pd
import streamlit as st
from openai import OpenAI
from datetime import datetime
from io import BytesIO
from dotenv import load_dotenv

load_dotenv()

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

    # ==========================================================================
    # Column Mappings - normalize different file formats to standard names
    # ==========================================================================

    # Map to "Collected Amount" (collections/payments)
    if 'Resolution amount' in df.columns:
        df['Collected Amount'] = pd.to_numeric(df['Resolution amount'], errors='coerce').fillna(0)
    elif 'paid_amount' in df.columns:
        df['Collected Amount'] = pd.to_numeric(df['paid_amount'], errors='coerce').fillna(0)
    elif 'transaction_amount_paid' in df.columns:
        df['Collected Amount'] = pd.to_numeric(df['transaction_amount_paid'], errors='coerce').fillna(0)
    elif 'Collected Amount' not in df.columns:
        df['Collected Amount'] = 0

    # Map to "POS" (Principal Outstanding / AUM)
    if 'Principal Balance Amount' in df.columns:
        df['POS'] = pd.to_numeric(df['Principal Balance Amount'], errors='coerce').fillna(0)
    elif 'allocation_amount' in df.columns:
        df['POS'] = pd.to_numeric(df['allocation_amount'], errors='coerce').fillna(0)
    elif 'amount_pending' in df.columns:
        df['POS'] = pd.to_numeric(df['amount_pending'], errors='coerce').fillna(0)
    elif 'Allocation amount' in df.columns:
        df['POS'] = pd.to_numeric(df['Allocation amount'], errors='coerce').fillna(0)
    elif 'POS' not in df.columns or df['POS'].isna().all():
        df['POS'] = df.get('Amount Pending', 0)

    # Map to "Region"
    if 'region' in df.columns and 'Region' not in df.columns:
        df['Region'] = df['region']

    # Map to "State"
    if 'customer_state' in df.columns and 'State' not in df.columns:
        df['State'] = df['customer_state']

    # Map to "DPD Bucket"
    if 'dpd_bucket' in df.columns and 'DPD Bucket' not in df.columns:
        df['DPD Bucket'] = df['dpd_bucket']

    # Map to "Agent Name"
    if 'agent_name' in df.columns and 'Agent Name' not in df.columns:
        df['Agent Name'] = df['agent_name']
    elif 'allocated_to_agent_name' in df.columns and 'Agent Name' not in df.columns:
        df['Agent Name'] = df['allocated_to_agent_name']

    # Map to "Loan Number"
    if 'loan_number' in df.columns and 'Loan Number' not in df.columns:
        df['Loan Number'] = df['loan_number']

    # Map cost columns
    if 'ivr_cost' in df.columns and 'IVR Cost' not in df.columns:
        df['IVR Cost'] = pd.to_numeric(df['ivr_cost'], errors='coerce').fillna(0)
    if 'wa_cost' in df.columns and 'WhatsApp Cost' not in df.columns:
        df['WhatsApp Cost'] = pd.to_numeric(df['wa_cost'], errors='coerce').fillna(0)
    if 'sms_cost' in df.columns and 'SMS Cost' not in df.columns:
        df['SMS Cost'] = pd.to_numeric(df['sms_cost'], errors='coerce').fillna(0)
    if 'call_cost' in df.columns and 'Call Cost' not in df.columns:
        df['Call Cost'] = pd.to_numeric(df['call_cost'], errors='coerce').fillna(0)

    # Map contact/call columns
    if 'contact_call_sent' in df.columns and 'Call Sent count' not in df.columns:
        df['Call Sent count'] = pd.to_numeric(df['contact_call_sent'], errors='coerce').fillna(0)
    if 'contact_call_delivered' in df.columns and 'Call Delivered count' not in df.columns:
        df['Call Delivered count'] = pd.to_numeric(df['contact_call_delivered'], errors='coerce').fillna(0)
    if 'contact_ivr_sent' in df.columns and 'IVR Sent count' not in df.columns:
        df['IVR Sent count'] = pd.to_numeric(df['contact_ivr_sent'], errors='coerce').fillna(0)
    if 'contact_wa_sent' in df.columns and 'WhatsApp Sent count' not in df.columns:
        df['WhatsApp Sent count'] = pd.to_numeric(df['contact_wa_sent'], errors='coerce').fillna(0)

    # Convert call-related columns to numeric (for old format)
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
        elif pos < 5000:
            return '<5K'
        elif pos < 10000:
            return '5K-10K'
        elif pos < 20000:
            return '10K-20K'
        else:
            return '>20K'

    df['POS Band'] = df['POS'].apply(get_pos_band)

    # Calculate DPD Bucket (granular ranges)
    if 'DPD' in df.columns:
        def get_dpd_bucket(dpd):
            if pd.isna(dpd):
                return 'Unknown'
            elif dpd < 0:
                return 'Pre-due'
            elif dpd < 30:
                return '0-30'
            elif dpd < 60:
                return '30-60'
            elif dpd < 90:
                return '60-90'
            elif dpd < 120:
                return '90-120'
            elif dpd < 240:
                return '120-240'
            elif dpd < 360:
                return '240-360'
            elif dpd < 450:
                return '360-450'
            elif dpd < 720:
                return '450-720'
            else:
                return '720+'
        df['DPD Bucket'] = df['DPD'].apply(get_dpd_bucket)

    # Calculate MOB Bucket (Month on Book)
    if 'Month on Book' in df.columns:
        def get_mob_bucket(mob):
            if pd.isna(mob):
                return 'Unknown'
            elif mob < 18:
                return '<1.5Years'
            elif mob < 24:
                return '1.5-2Years'
            elif mob < 60:
                return '2-5Years'
            else:
                return '>5Years'
        df['MOB Bucket'] = df['Month on Book'].apply(get_mob_bucket)

    # Map State to Region (India)
    state_region_map = {
        'Delhi': 'North', 'Punjab': 'North', 'Haryana': 'North', 'Himachal Pradesh': 'North',
        'Jammu and Kashmir': 'North', 'Uttarakhand': 'North', 'Uttar Pradesh': 'North',
        'Rajasthan': 'North', 'Chandigarh': 'North',
        'Gujarat': 'West', 'Maharashtra': 'West', 'Goa': 'West', 'Daman and Diu': 'West',
        'Madhya Pradesh': 'West', 'Dadra and Nagar Haveli': 'West',
        'Kerala': 'South', 'Tamil Nadu': 'South', 'Karnataka': 'South', 'Andhra Pradesh': 'South',
        'Telangana': 'South', 'Puducherry': 'South', 'Lakshadweep': 'South',
        'West Bengal': 'East', 'Odisha': 'East', 'Bihar': 'East', 'Jharkhand': 'East',
        'Assam': 'East', 'Arunachal Pradesh': 'East', 'Chhattisgarh': 'East',
        'Meghalaya': 'East', 'Tripura': 'East', 'Nagaland': 'East', 'Manipur': 'East',
        'Sikkim': 'East', 'Andaman and Nicobar Islands': 'East', 'Mizoram': 'East'
    }
    if 'State' in df.columns and 'Region' not in df.columns:
        df['Region'] = df['State'].map(state_region_map)

    # Calculate Resolved flag
    df['Resolved'] = (df['Status'] == 'COLLECTED').astype(int)

    # Calculate PTP flags based on dispositions
    if 'IVR Interactive Response' in df.columns:
        df['IVR PTP'] = df['IVR Interactive Response'].isin(['Promise to pay']).astype(int)
    if 'WhatsApp Interactive Response' in df.columns:
        df['WhatsApp PTP'] = df['WhatsApp Interactive Response'].isin(['Promise to pay']).astype(int)
    if 'Best Disposition' in df.columns:
        ptp_dispositions = ['Maintain Balance', 'Promised to Pay', 'Already Paid', 'Paid on Call', 'Claims Paid', 'Partially Paid']
        df['Call PTP'] = df['Best Disposition'].isin(ptp_dispositions).astype(int)
    if 'Voice Bot Best Disposition' in df.columns:
        tara_ptp_dispositions = ['Promised to Pay', 'Claims Paid', 'Already Paid', 'Paid on Call', 'Maintain Balance', 'PART PAID']
        df['Tara Call PTP'] = df['Voice Bot Best Disposition'].isin(tara_ptp_dispositions).astype(int)

    # Calculate Attempt and Contact flags
    for channel in ['IVR', 'WhatsApp', 'SMS', 'Call']:
        sent_col = f'{channel} Sent count'
        delivered_col = f'{channel} Delivered count'
        if sent_col in df.columns:
            df[f'{channel} Attempt'] = (df[sent_col] > 0).astype(int)
        if delivered_col in df.columns:
            df[f'{channel} Contact'] = (df[delivered_col] > 0).astype(int)

    # Tara Call (Voice Bot) specific
    if 'Tara Call Sent Count' in df.columns:
        df['Tara Call Attempt'] = (df['Tara Call Sent Count'] > 0).astype(int)
    if 'Tara Call Delivered Count' in df.columns:
        df['Tara Call Contact'] = (df['Tara Call Delivered Count'] > 0).astype(int)

    # Calculate PTP Conversions (PTP that resulted in collection)
    if 'Call PTP' in df.columns:
        df['Call PTP Conversion'] = ((df.get('Call PTP', 0) == 1) & (df['Status'] == 'COLLECTED')).astype(int)
    if 'IVR PTP' in df.columns:
        df['IVR PTP Conversion'] = ((df.get('IVR PTP', 0) == 1) & (df['Status'] == 'COLLECTED')).astype(int)
    if 'WhatsApp PTP' in df.columns:
        df['WhatsApp PTP Conversion'] = ((df.get('WhatsApp PTP', 0) == 1) & (df['Status'] == 'COLLECTED')).astype(int)
    if 'Tara Call PTP' in df.columns:
        df['Tara Call PTP Conversion'] = ((df.get('Tara Call PTP', 0) == 1) & (df['Status'] == 'COLLECTED')).astype(int)

    # Overall PTP (any channel)
    ptp_cols = ['IVR PTP', 'WhatsApp PTP', 'Call PTP', 'Tara Call PTP']
    existing_ptp_cols = [col for col in ptp_cols if col in df.columns]
    if existing_ptp_cols:
        df['Overall PTP'] = (df[existing_ptp_cols].sum(axis=1) > 0).astype(int)
        df['Overall PTP Conversion'] = ((df['Overall PTP'] == 1) & (df['Status'] == 'COLLECTED')).astype(int)

    # Overall Attempted and Contactable
    attempt_cols = ['IVR Attempt', 'WhatsApp Attempt', 'SMS Attempt', 'Call Attempt', 'Tara Call Attempt']
    existing_attempt_cols = [col for col in attempt_cols if col in df.columns]
    if existing_attempt_cols:
        df['Overall Attempted'] = (df[existing_attempt_cols].sum(axis=1) > 0).astype(int)

    contact_cols = ['IVR Contact', 'WhatsApp Contact', 'SMS Contact', 'Call Contact', 'Tara Call Contact']
    existing_contact_cols = [col for col in contact_cols if col in df.columns]
    if existing_contact_cols:
        df['Overall Contactable'] = (df[existing_contact_cols].sum(axis=1) > 0).astype(int)

    # Voice specific (IVR + Call + Tara)
    voice_attempt_cols = ['IVR Attempt', 'Call Attempt', 'Tara Call Attempt']
    existing_voice_attempt = [col for col in voice_attempt_cols if col in df.columns]
    if existing_voice_attempt:
        df['Voice Attempted'] = (df[existing_voice_attempt].sum(axis=1) > 0).astype(int)

    voice_contact_cols = ['IVR Contact', 'Call Contact', 'Tara Call Contact']
    existing_voice_contact = [col for col in voice_contact_cols if col in df.columns]
    if existing_voice_contact:
        df['Voice Contactable'] = (df[existing_voice_contact].sum(axis=1) > 0).astype(int)

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


def build_preview_system_prompt(df: pd.DataFrame) -> str:
    """
    Build the system prompt for the FIRST LLM call - parsing query into preview structure.
    Returns JSON describing output columns, logic, and row labels.
    """
    column_info = get_column_descriptions(df)
    regions = list(df['Region'].dropna().unique()) if 'Region' in df.columns else []
    states = list(df['State'].dropna().unique())[:15] if 'State' in df.columns else []
    dpd_buckets = list(df['DPD Bucket'].dropna().unique()) if 'DPD Bucket' in df.columns else []
    pos_bands = list(df['POS Band'].dropna().unique()) if 'POS Band' in df.columns else []
    mob_buckets = list(df['MOB Bucket'].dropna().unique()) if 'MOB Bucket' in df.columns else []
    allocation_names = list(df['Allocation Name'].dropna().unique())[:10] if 'Allocation Name' in df.columns else []
    loan_products = list(df['Loan Product'].dropna().unique()) if 'Loan Product' in df.columns else []

    # Get DPD range
    dpd_range = ""
    if 'DPD' in df.columns:
        dpd_range = f"DPD numeric range: {df['DPD'].min():.0f} to {df['DPD'].max():.0f}"

    return f"""You are a query parser for a loan collections analytics system.
Your job is to analyze a natural language query and return a JSON structure describing
what the output table will look like and the logic for each column.

## Available DataFrame Columns:
{column_info}

## Available Values:
- Regions: {regions}
- States (sample): {states}
- DPD Buckets: {dpd_buckets}
- {dpd_range}
- POS Bands: {pos_bands}
- MOB Buckets (Month on Book): {mob_buckets}
- Allocation Names (sample): {allocation_names}
- Loan Products: {loan_products}

## Key Metrics and Terminology:
- **DPD (Days Past Due)**: Number of days a payment is overdue. This is NPA portfolio so DPD is high (300-1000+).
- **POS (Principal Outstanding)**: Remaining loan principal = Principal Balance Amount. Also called AUM.
- **AUM (Assets Under Management)**: Same as POS = Allocation amount
- **Count of Cases**: Count of Loan Number (unique loans)
- **Resolved Count**: Count where Status = COLLECTED
- **Count Efficiency**: (Resolved Count / Count of Cases) * 100
- **Amount Efficiency**: (Collected Amount / AUM) * 100
- **POS Efficiency**: (POS Collected / Total POS) * 100
- **MOB (Month on Book)**: How long since loan was disbursed

## Communication Channel Metrics:
- **Attempt Coverage**: (Channel Attempt / Count of Cases) * 100 - % of cases where channel was attempted
- **Connect Coverage**: (Channel Contact / Count of Cases) * 100 - % of cases where channel connected
- **Connectivity**: (Channel Contact / Channel Attempt) * 100 - % of attempts that connected
- Channels: IVR, SMS, WhatsApp, Call, Tara Call (Voice Bot)

## PTP (Promise to Pay) Metrics:
- **PTP Generation**: (Channel PTP / Count of Cases) * 100 - % of cases with PTP
- **PTP Conversion Rate**: (Channel PTP Conversion / Channel PTP) * 100 - % of PTPs that resolved
- **Call Intensity**: Call Sent count / Count of Cases

## Common Grouping Dimensions:
- DPD Bucket: <360, 360-450, 450-720, >720
- POS Band: <5K, 5K-10K, 10K-20K, >20K
- MOB Bucket: <1.5Years, 1.5-2Years, 2-5Years, >5Years
- Region: North, South, East, West
- State, Allocation Name, Loan Product, Priority

## Output JSON Schema:
Return ONLY valid JSON with this structure:
{{
  "grouping_column": "Name of the column to group by (e.g., 'Region', 'DPD Bucket', 'State')",
  "output_columns": [
    {{"name": "Column Name", "logic": "Human-readable logic description", "type": "dimension|metric"}},
    ...
  ],
  "row_labels": ["Label1", "Label2", ..., "Grand Total"],
  "filters": ["Any filters to apply, or empty array"],
  "sort_by": "Column name to sort by",
  "sort_ascending": true or false
}}

## Rules:
1. Return ONLY valid JSON - no explanations, no markdown
2. Always include a "Grand Total" row in row_labels
3. For dimensions (grouping columns), type is "dimension"
4. For calculated values (sum, count, avg, rate), type is "metric"
5. Logic descriptions should be clear and editable by non-technical users
6. Use actual column names from the DataFrame in logic descriptions

## Example:
Query: "efficiency by DPD bucket"
Response:
{{
  "grouping_column": "DPD Bucket",
  "output_columns": [
    {{"name": "DPD Bucket", "logic": "Group by DPD Bucket column", "type": "dimension"}},
    {{"name": "Count of Cases", "logic": "Count of Loan Number per group", "type": "metric"}},
    {{"name": "Resolved Count", "logic": "Sum of Resolved per group", "type": "metric"}},
    {{"name": "Count Efficiency", "logic": "(Resolved Count / Count of Cases) * 100", "type": "metric"}},
    {{"name": "AUM", "logic": "Sum of Allocation amount per group", "type": "metric"}},
    {{"name": "Amount Efficiency", "logic": "(Collected Amount / AUM) * 100", "type": "metric"}}
  ],
  "row_labels": ["Pre-due", "0-30", "30-60", "60-90", "90-120", "120-240", "240-360", "360-450", "450-720", "720+", "Grand Total"],
  "filters": [],
  "sort_by": "Count Efficiency",
  "sort_ascending": false
}}

Query: "call connectivity by region"
Response:
{{
  "grouping_column": "Region",
  "output_columns": [
    {{"name": "Region", "logic": "Group by Region column", "type": "dimension"}},
    {{"name": "Count of Cases", "logic": "Count of Loan Number per group", "type": "metric"}},
    {{"name": "Call Sent count", "logic": "Sum of Call Sent count per group", "type": "metric"}},
    {{"name": "Call Attempt Coverage", "logic": "(Call Attempt / Count of Cases) * 100", "type": "metric"}},
    {{"name": "Call Connect Coverage", "logic": "(Call Contact / Count of Cases) * 100", "type": "metric"}},
    {{"name": "Call Connectivity", "logic": "(Call Contact / Call Attempt) * 100", "type": "metric"}}
  ],
  "row_labels": ["North", "South", "East", "West", "Grand Total"],
  "filters": [],
  "sort_by": "Call Connectivity",
  "sort_ascending": false
}}

Query: "PTP generation and conversion by POS band"
Response:
{{
  "grouping_column": "POS Band",
  "output_columns": [
    {{"name": "POS Band", "logic": "Group by POS Band column", "type": "dimension"}},
    {{"name": "Count of Cases", "logic": "Count of Loan Number per group", "type": "metric"}},
    {{"name": "Call PTP", "logic": "Sum of Call PTP per group", "type": "metric"}},
    {{"name": "Call PTP Generation", "logic": "(Call PTP / Count of Cases) * 100", "type": "metric"}},
    {{"name": "Call PTP Conversion", "logic": "Sum of Call PTP Conversion per group", "type": "metric"}},
    {{"name": "Call PTP Conversion Rate", "logic": "(Call PTP Conversion / Call PTP) * 100", "type": "metric"}}
  ],
  "row_labels": ["<5K", "5K-10K", "10K-20K", ">20K", "Grand Total"],
  "filters": [],
  "sort_by": "Call PTP Conversion Rate",
  "sort_ascending": false
}}

Now parse the user's query and return ONLY the JSON structure."""


def build_code_generation_prompt(df: pd.DataFrame, original_query: str, confirmed_logic: list, preview_data: dict) -> str:
    """
    Build the system prompt for the SECOND LLM call - generating pandas code from confirmed logic.
    """
    column_info = get_column_descriptions(df)
    regions = list(df['Region'].unique()) if 'Region' in df.columns else []

    # Get all column names for reference
    all_columns = df.columns.tolist()

    # Get DPD range info
    dpd_info = ""
    if 'DPD' in df.columns:
        dpd_min = df['DPD'].min()
        dpd_max = df['DPD'].max()
        dpd_info = f"DPD column range: {dpd_min} to {dpd_max}"
    if 'DPD Bucket' in df.columns:
        dpd_buckets = df['DPD Bucket'].unique().tolist()
        dpd_info += f"\nExisting DPD Bucket values: {dpd_buckets}"

    # Format the confirmed logic table
    logic_lines = []
    for col in confirmed_logic:
        # Handle both key formats ('name'/'logic' and 'Column'/'Logic')
        col_name = col.get('name') or col.get('Column') or ''
        col_logic = col.get('logic') or col.get('Logic') or ''
        if col_name and col_logic:
            logic_lines.append(f"- {col_name}: {col_logic}")
    logic_text = "\n".join(logic_lines)

    filters_list = preview_data.get('filters', [])
    if filters_list:
        filters_text = "\n".join([f"- {f}" for f in filters_list])
    else:
        filters_text = "None - use ALL data"

    return f"""You are a pandas code generator for a loan collections analytics system.
Generate executable pandas code based on the CONFIRMED logic below.

## Available DataFrame: `df`
The DataFrame has {len(df)} rows and the following columns:
{column_info}

## Data Info:
{dpd_info}
Available Regions: {regions}

## ALL Available Column Names (use these exact names in code):
{all_columns}

## Common Column Mappings:
- IVR spent/cost → 'IVR Cost'
- WhatsApp/WA spent/cost → 'WhatsApp Cost'
- IVR sent/attempts → 'IVR Sent count'
- WhatsApp sent/attempts → 'WhatsApp Sent count'
- Calls/attempts → 'Call Sent count'
- Connects/delivered → 'Call Delivered count'
- Tara/Voice Bot sent → 'Tara Call Sent Count'
- Tara/Voice Bot delivered → 'Tara Call Delivered Count'
- Collection/collected → 'Resolution amount' (when Status=COLLECTED)
- AUM/allocation → 'Allocation amount'
- POS/principal/outstanding → 'Principal Balance Amount' or 'POS'
- Cases/count → count of 'Loan Number'
- Resolved/collected cases → sum of 'Resolved' (where Status=COLLECTED)
- Count Efficiency → (Resolved Count / Count of Cases) * 100
- Amount Efficiency → (Collected Amount / AUM) * 100
- PTP (Promise to Pay) → 'Call PTP', 'IVR PTP', 'WhatsApp PTP', 'Tara Call PTP'
- Attempt → 'Call Attempt', 'IVR Attempt', etc. (1 if sent count > 0)
- Contact → 'Call Contact', 'IVR Contact', etc. (1 if delivered count > 0)

## Original Query: "{original_query}"

## CONFIRMED Output Logic (follow this EXACTLY):
{logic_text}

## Filters to Apply:
{filters_text}

## How to Apply Filters:
- "last N days" → filter by Upload Date or relevant date column >= (today - N days)
- "Region = X" → df[df['Region'] == 'X']
- "Region in (X, Y)" → df[df['Region'].isin(['X', 'Y'])]
- "DPD > N" → df[df['DPD'] > N]
- "DPD between X and Y" → df[(df['DPD'] >= X) & (df['DPD'] <= Y)]
- "exclude X" → filter OUT rows matching that condition
- "X is not null" → df[df['X'].notna()]
- If "None - use ALL data", do NOT add any filters

## Sorting:
- Sort by: {preview_data.get('sort_by', 'first metric column')}
- Ascending: {preview_data.get('sort_ascending', False)}

## Critical Rules:
1. Return ONLY executable pandas code - no explanations, no markdown backticks
2. The code must produce a DataFrame named `result`
3. The input DataFrame is called `df`
4. Follow the confirmed logic EXACTLY as specified above
5. Always include Grand Total row at the END using pd.concat
6. Round percentage values to 2 decimal places
7. IMPORTANT: Do NOT add date filters unless the user explicitly asks for MTD or a specific date range
8. Use ALL data in df unless filters are explicitly specified in the confirmed logic

## Interpreting Custom Logic:
- If logic says "Cut DPD at X, Y, Z" or "Create buckets X-Y, Y-Z, Z+", use pd.cut() on the DPD column
- If logic says "Group by X column", use df.groupby('X', observed=True)
- "Sum of X per group" means .agg({{'X': 'sum'}})
- "Count of X per group" means .agg({{'X': 'count'}})
- "(A / B) * 100" means calculate after aggregation: (result['A'] / result['B'] * 100)

## WORKING CODE EXAMPLE for Count/Amount Efficiency by DPD Bucket:
IMPORTANT: Do NOT add any date filters - use ALL data in df.
```
result = df.groupby('DPD Bucket', observed=True).agg({{
    'Loan Number': 'count',
    'Resolved': 'sum',
    'Allocation amount': 'sum',
    'Resolution amount': 'sum',
    'POS': 'sum'
}}).reset_index()
result.columns = ['DPD Bucket', 'Count of Cases', 'Resolved Count', 'AUM', 'Collected Amount', 'Total POS']
result['Count Efficiency'] = (result['Resolved Count'] / result['Count of Cases'] * 100).round(2)
result['Amount Efficiency'] = (result['Collected Amount'] / result['AUM'] * 100).round(2)
grand_total = pd.DataFrame([{{
    'DPD Bucket': 'Grand Total',
    'Count of Cases': result['Count of Cases'].sum(),
    'Resolved Count': result['Resolved Count'].sum(),
    'AUM': result['AUM'].sum(),
    'Collected Amount': result['Collected Amount'].sum(),
    'Total POS': result['Total POS'].sum(),
    'Count Efficiency': (result['Resolved Count'].sum() / result['Count of Cases'].sum() * 100).round(2),
    'Amount Efficiency': (result['Collected Amount'].sum() / result['AUM'].sum() * 100).round(2)
}}])
result = pd.concat([result, grand_total], ignore_index=True)
# Sort by DPD bucket order
dpd_order = ['Pre-due', '0-30', '30-60', '60-90', '90-120', '120-240', '240-360', '360-450', '450-720', '720+', 'Grand Total']
result['DPD Bucket'] = pd.Categorical(result['DPD Bucket'], categories=dpd_order, ordered=True)
result = result.sort_values('DPD Bucket')
```

## WORKING CODE EXAMPLE for Call Connectivity by Region:
```
result = df.groupby('Region', observed=True).agg({{
    'Loan Number': 'count',
    'Call Sent count': 'sum',
    'Call Attempt': 'sum',
    'Call Contact': 'sum'
}}).reset_index()
result.columns = ['Region', 'Count of Cases', 'Call Sent count', 'Call Attempt', 'Call Contact']
result['Call Attempt Coverage'] = (result['Call Attempt'] / result['Count of Cases'] * 100).round(2)
result['Call Connect Coverage'] = (result['Call Contact'] / result['Count of Cases'] * 100).round(2)
result['Call Connectivity'] = (result['Call Contact'] / result['Call Attempt'] * 100).round(2)
grand_total = pd.DataFrame([{{
    'Region': 'Grand Total',
    'Count of Cases': result['Count of Cases'].sum(),
    'Call Sent count': result['Call Sent count'].sum(),
    'Call Attempt': result['Call Attempt'].sum(),
    'Call Contact': result['Call Contact'].sum(),
    'Call Attempt Coverage': (result['Call Attempt'].sum() / result['Count of Cases'].sum() * 100).round(2),
    'Call Connect Coverage': (result['Call Contact'].sum() / result['Count of Cases'].sum() * 100).round(2),
    'Call Connectivity': (result['Call Contact'].sum() / result['Call Attempt'].sum() * 100).round(2)
}}])
result = pd.concat([result, grand_total], ignore_index=True)
```

## WORKING CODE EXAMPLE for PTP Generation and Conversion:
```
result = df.groupby('POS Band', observed=True).agg({{
    'Loan Number': 'count',
    'Call PTP': 'sum',
    'Call PTP Conversion': 'sum'
}}).reset_index()
result.columns = ['POS Band', 'Count of Cases', 'Call PTP', 'Call PTP Conversion']
result['Call PTP Generation'] = (result['Call PTP'] / result['Count of Cases'] * 100).round(2)
result['Call PTP Conversion Rate'] = (result['Call PTP Conversion'] / result['Call PTP'] * 100).round(2)
grand_total = pd.DataFrame([{{
    'POS Band': 'Grand Total',
    'Count of Cases': result['Count of Cases'].sum(),
    'Call PTP': result['Call PTP'].sum(),
    'Call PTP Conversion': result['Call PTP Conversion'].sum(),
    'Call PTP Generation': (result['Call PTP'].sum() / result['Count of Cases'].sum() * 100).round(2),
    'Call PTP Conversion Rate': (result['Call PTP Conversion'].sum() / result['Call PTP'].sum() * 100).round(2)
}}])
result = pd.concat([result, grand_total], ignore_index=True)
# Sort by POS Band order
pos_order = ['<5K', '5K-10K', '10K-20K', '>20K', 'Grand Total']
result['POS Band'] = pd.Categorical(result['POS Band'], categories=pos_order, ordered=True)
result = result.sort_values('POS Band')
```

## IMPORTANT:
- For EVERY column in the confirmed logic, include it in the groupby agg() and in the grand_total calculation
- Map user-friendly names to actual DataFrame columns using the mappings above
- Always use observed=True in groupby to avoid empty categories

## Column Name Mappings (use in output):
- 'Principal Balance Amount' or 'POS' → 'Total POS' in output
- 'Allocation amount' → 'AUM' in output
- 'Resolution amount' → 'Collected Amount' in output
- Efficiency columns should be percentages rounded to 2 decimals

## DPD Bucket Order (for sorting):
["Pre-due", "0-30", "30-60", "60-90", "90-120", "120-240", "240-360", "360-450", "450-720", "720+"]

## POS Band Order (for sorting):
["<5K", "5K-10K", "10K-20K", ">20K"]

## MOB Bucket Order (for sorting):
["<1.5Years", "1.5-2Years", "2-5Years", ">5Years"]

Now generate pandas code that follows the confirmed logic exactly. Return ONLY the code."""


# =============================================================================
# LLM INTEGRATION
# =============================================================================

def get_openai_client():
    """Get configured OpenAI client."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable not set")
    return OpenAI(api_key=api_key)


def modify_logic_with_followup(current_logic: list, followup: str, df: pd.DataFrame) -> list:
    """
    Modify existing logic based on a follow-up message.
    """
    client = get_openai_client()

    all_columns = df.columns.tolist()

    # Format current logic for the prompt
    current_logic_str = "\n".join([f"- {col.get('Column', col.get('name', ''))}: {col.get('Logic', col.get('logic', ''))}"
                                    for col in current_logic])

    system_prompt = f"""You are modifying an existing query logic based on user feedback.

CURRENT COLUMNS AND LOGIC:
{current_logic_str}

AVAILABLE DATAFRAME COLUMNS (use exact names): {all_columns}

COLUMN NAME MAPPINGS (user term → actual column name):
- "IVR cost" or "IVR spent" → use column 'IVR Cost'
- "WhatsApp cost" or "WA cost" → use column 'WhatsApp Cost'
- "IVR sent" or "IVR attempts" → use column 'IVR Sent count'
- "WhatsApp sent" → use column 'WhatsApp Sent count'
- "calls" or "attempts" → use column 'Call Sent count'
- "connects" → use column 'Call Delivered count'

USER REQUEST: {followup}

INSTRUCTIONS:
1. If user says "add X column" - ADD a new entry to the list with appropriate logic
2. If user says "remove X" - REMOVE that column from the list
3. If user says "change X to Y" - UPDATE the logic for that column
4. Keep all other columns unchanged

Return ONLY a valid JSON array with ALL columns (existing + any new ones):
[
  {{"Column": "column name", "Logic": "what to calculate"}},
  ...
]

IMPORTANT: Include ALL existing columns plus any new ones. Do not remove columns unless explicitly asked."""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Update the logic: {followup}"}
        ],
        temperature=0,
        max_tokens=2000
    )

    response_text = response.choices[0].message.content.strip()

    # Clean up response
    if response_text.startswith('```'):
        response_text = response_text.split('```')[1]
        if response_text.startswith('json'):
            response_text = response_text[4:]
        response_text = response_text.strip()

    return json.loads(response_text)


def parse_query_to_preview(user_query: str, system_prompt: str) -> dict:
    """
    FIRST LLM call: Parse natural language query into preview structure.
    Returns JSON with output columns, logic, and row labels.
    """
    client = get_openai_client()

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_query}
        ],
        temperature=0,
        max_tokens=2000
    )

    response_text = response.choices[0].message.content.strip()

    # Clean up response - remove markdown if present
    if response_text.startswith('```'):
        response_text = response_text.split('```')[1]
        if response_text.startswith('json'):
            response_text = response_text[4:]
        response_text = response_text.strip()

    # Parse JSON
    try:
        preview_data = json.loads(response_text)
        return preview_data
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse LLM response as JSON: {e}\nResponse: {response_text}")


def generate_pandas_code(user_query: str, system_prompt: str) -> dict:
    """
    SECOND LLM call: Generate pandas code and SQL from confirmed logic.
    Returns dict with 'python' and 'sql' keys.
    """
    client = get_openai_client()

    # Modify prompt to request both Python and SQL
    enhanced_prompt = system_prompt + """

## Output Format:
Return your response in this exact format with both Python and SQL:

PYTHON:
```python
<your pandas code here>
```

SQL:
```sql
<equivalent SQL query here>
```

The SQL should be a standard SELECT query that would produce the same result.
Assume the table is named 'loans' with the same column names as the DataFrame."""

    response = client.chat.completions.create(
        model="gpt-4.1-mini",
        messages=[
            {"role": "system", "content": enhanced_prompt},
            {"role": "user", "content": user_query}
        ],
        temperature=0,
        max_tokens=10000
    )

    response_text = response.choices[0].message.content.strip()

    # Parse Python and SQL from response
    result = {'python': '', 'sql': ''}

    # Extract Python code
    if 'PYTHON:' in response_text:
        python_part = response_text.split('PYTHON:')[1]
        if 'SQL:' in python_part:
            python_part = python_part.split('SQL:')[0]
        # Extract code from markdown blocks
        if '```python' in python_part:
            python_part = python_part.split('```python')[1].split('```')[0]
        elif '```' in python_part:
            python_part = python_part.split('```')[1].split('```')[0]
        result['python'] = python_part.strip()
    elif '```python' in response_text:
        # No PYTHON: header but has python code block
        python_part = response_text.split('```python')[1].split('```')[0]
        result['python'] = python_part.strip()
    else:
        # Fallback - try to extract just the Python part
        # Look for common SQL indicators to separate Python from SQL
        python_part = response_text

        # Remove SQL section if present (handles various formats)
        for sql_marker in ['\nSQL:', '\nsql\n', '\n```sql', '\nSELECT ', '\nselect ']:
            if sql_marker in python_part:
                python_part = python_part.split(sql_marker)[0]
                break

        # Clean up markdown
        python_part = python_part.replace('```python', '').replace('```', '').strip()
        result['python'] = python_part

    # Extract SQL code
    if 'SQL:' in response_text:
        sql_part = response_text.split('SQL:')[1]
        if '```sql' in sql_part:
            sql_part = sql_part.split('```sql')[1].split('```')[0]
        elif '```' in sql_part:
            sql_part = sql_part.split('```')[1].split('```')[0]
        result['sql'] = sql_part.strip()
    elif '```sql' in response_text:
        # No SQL: header but has sql code block
        sql_part = response_text.split('```sql')[1].split('```')[0]
        result['sql'] = sql_part.strip()

    return result


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

    # Use textwrap.dedent to remove common leading whitespace
    code = textwrap.dedent(code)

    # Normalize tabs to spaces
    code = code.replace('\t', '    ')

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
    - Efficiency/Rate/% columns: Green gradient (higher = darker)
    - Collection/Amount/AUM/POS columns: Blue gradient
    """
    # Identify columns to format
    conversion_cols = [col for col in df.columns
                       if 'efficiency' in col.lower() or 'conversion' in col.lower() or '%' in col.lower()
                       or 'rate' in col.lower() or 'coverage' in col.lower() or 'connectivity' in col.lower()
                       or 'generation' in col.lower()]
    amount_cols = [col for col in df.columns
                   if 'collection' in col.lower() or 'amount' in col.lower() or 'pos' in col.lower()
                   or 'aum' in col.lower() or 'resolved' in col.lower()]

    # Create styler
    styler = df.style

    # Apply green gradient to conversion columns
    for col in conversion_cols:
        if col in df.columns and pd.api.types.is_numeric_dtype(df[col]):
            # Only apply gradient if there are non-null numeric values
            if df[col].notna().any():
                styler = styler.background_gradient(subset=[col], cmap='Greens', vmin=0)

    # Apply blue gradient to amount columns
    for col in amount_cols:
        if col in df.columns and pd.api.types.is_numeric_dtype(df[col]):
            # Only apply gradient if there are non-null numeric values
            if df[col].notna().any():
                styler = styler.background_gradient(subset=[col], cmap='Blues', vmin=0)

    # Format numbers - handle None/NaN gracefully
    styler = styler.format(precision=2, thousands=',', na_rep='—')

    return styler


def export_to_excel(df: pd.DataFrame) -> BytesIO:
    """Export DataFrame to Excel file in memory."""
    output = BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Query Results')
    output.seek(0)
    return output


def export_to_csv(df: pd.DataFrame) -> str:
    """Export DataFrame to CSV string."""
    return df.to_csv(index=False)


def create_preview_table(preview_data: dict) -> pd.DataFrame:
    """Create a preview table with placeholder values."""
    columns = [col.get('name', col.get('Column', '')) for col in preview_data['output_columns']]
    row_labels = preview_data.get('row_labels', ['Row 1', 'Row 2', 'Grand Total'])

    # Create empty DataFrame with placeholders
    data = []
    grouping_col = preview_data.get('grouping_column', columns[0] if columns else 'Group')

    for label in row_labels:
        row = {}
        for i, col in enumerate(columns):
            col_data = preview_data['output_columns'][i]
            col_type = col_data.get('type', 'metric')  # Default to metric if not specified
            if col == grouping_col or col_type == 'dimension':
                row[col] = label
            else:
                row[col] = "—"
        data.append(row)

    return pd.DataFrame(data)


def create_logic_table(preview_data: dict) -> pd.DataFrame:
    """Create an editable logic table from preview data."""
    data = []
    for col in preview_data['output_columns']:
        data.append({
            'Column': col.get('name', col.get('Column', '')),
            'Logic': col.get('logic', col.get('Logic', ''))
        })
    return pd.DataFrame(data)


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
    st.caption("Ask questions about your portfolio in plain English")

    # Initialize session state
    if 'thread_history' not in st.session_state:
        st.session_state.thread_history = []  # Last 5 completed threads
    if 'current_thread' not in st.session_state:
        st.session_state.current_thread = []  # Current conversation messages
    if 'last_result' not in st.session_state:
        st.session_state.last_result = None
    if 'current_query' not in st.session_state:
        st.session_state.current_query = None
    if 'preview_data' not in st.session_state:
        st.session_state.preview_data = None
    if 'pending_query' not in st.session_state:
        st.session_state.pending_query = None
    if 'run_confirmed' not in st.session_state:
        st.session_state.run_confirmed = False
    if 'last_generated_code' not in st.session_state:
        st.session_state.last_generated_code = None
    if 'confirmed_logic' not in st.session_state:
        st.session_state.confirmed_logic = None
    if 'confirmed_filters' not in st.session_state:
        st.session_state.confirmed_filters = []
    if 'renaming_thread' not in st.session_state:
        st.session_state.renaming_thread = None
    if 'active_thread_index' not in st.session_state:
        st.session_state.active_thread_index = None

    # Load data
    data_file = "/Users/aditya/Documents/DPDzero/PORTFOLIO_D666H34OQOBG04EVDGD0.csv"

    try:
        with st.spinner("Loading data..."):
            df = load_and_process_data(data_file)
    except FileNotFoundError:
        st.error(f"Data file '{data_file}' not found. Please ensure the file exists in the app directory.")
        st.stop()
    except Exception as e:
        st.error(f"Error loading data: {str(e)}")
        st.stop()

    # Build system prompts
    preview_system_prompt = build_preview_system_prompt(df)

    # ==========================================================================
    # SIDEBAR
    # ==========================================================================
    with st.sidebar:
        st.header("📈 Data Overview")

        # Basic stats
        st.metric("Total Cases", f"{len(df):,}")

        # Key metrics
        if 'Resolved' in df.columns:
            resolved_count = df['Resolved'].sum()
            count_eff = (resolved_count / len(df) * 100) if len(df) > 0 else 0
            st.metric("Resolved", f"{int(resolved_count):,}", f"{count_eff:.1f}% efficiency")

        # DPD stats
        if 'DPD' in df.columns:
            avg_dpd = df['DPD'].mean()
            st.text(f"Avg DPD: {avg_dpd:.0f} days")

        # POS stats
        if 'POS' in df.columns:
            total_pos = df['POS'].sum()
            st.text(f"Total POS: ₹{total_pos/10000000:.2f} Cr")

        # Allocation info
        if 'Allocation Name' in df.columns:
            alloc_count = df['Allocation Name'].nunique()
            st.text(f"Allocations: {alloc_count}")

        # Regions available
        if 'Region' in df.columns:
            regions = df['Region'].dropna().unique().tolist()
            st.text(f"Regions: {', '.join(map(str, regions))}")

        # States count
        if 'State' in df.columns:
            state_count = df['State'].nunique()
            st.text(f"States: {state_count}")

        st.divider()

        # Thread history
        st.header("🕐 Recent Threads")

        if st.session_state.thread_history:
            for i, thread in enumerate(st.session_state.thread_history):
                # Show custom name or first message as thread title
                thread_title = thread.get('name', thread['messages'][0]['content'][:40] + "..." if len(thread['messages'][0]['content']) > 40 else thread['messages'][0]['content'])

                col1, col2 = st.columns([4, 1])
                with col1:
                    if st.button(thread_title, key=f"thread_{i}", use_container_width=True):
                        # Restore this thread
                        st.session_state.current_thread = thread['messages'].copy()
                        st.session_state.last_result = thread.get('last_result')
                        st.session_state.confirmed_logic = thread.get('confirmed_logic')
                        st.session_state.confirmed_filters = thread.get('confirmed_filters', [])
                        st.session_state.last_generated_code = thread.get('last_generated_code')
                        st.session_state.active_thread_index = i
                        st.session_state.preview_data = None
                        st.session_state.current_query = None
                        st.rerun()
                with col2:
                    if st.button("✏️", key=f"rename_{i}", help="Rename thread"):
                        st.session_state.renaming_thread = i
                        st.rerun()

            # Show rename input if renaming
            if 'renaming_thread' in st.session_state and st.session_state.renaming_thread is not None:
                idx = st.session_state.renaming_thread
                if idx < len(st.session_state.thread_history):
                    new_name = st.text_input(
                        "New thread name:",
                        value=st.session_state.thread_history[idx].get('name', ''),
                        key="rename_input"
                    )
                    col1, col2 = st.columns(2)
                    with col1:
                        if st.button("Save", key="save_rename"):
                            st.session_state.thread_history[idx]['name'] = new_name
                            st.session_state.renaming_thread = None
                            st.rerun()
                    with col2:
                        if st.button("Cancel", key="cancel_rename"):
                            st.session_state.renaming_thread = None
                            st.rerun()
        else:
            st.caption("No threads yet. Start a conversation below!")

        # New thread button
        if st.session_state.current_thread:
            st.divider()
            if st.button("➕ New Thread", use_container_width=True):
                # Save current thread to history
                if st.session_state.current_thread:
                    thread_data = {
                        'messages': st.session_state.current_thread.copy(),
                        'last_result': st.session_state.last_result,
                        'confirmed_logic': st.session_state.confirmed_logic,
                        'confirmed_filters': st.session_state.confirmed_filters,
                        'last_generated_code': st.session_state.last_generated_code
                    }
                    st.session_state.thread_history.insert(0, thread_data)
                    st.session_state.thread_history = st.session_state.thread_history[:5]
                # Clear current state
                st.session_state.current_thread = []
                st.session_state.last_result = None
                st.session_state.preview_data = None
                st.session_state.confirmed_logic = None
                st.session_state.confirmed_filters = []
                st.session_state.last_generated_code = None
                st.session_state.active_thread_index = None
                st.rerun()

        st.divider()

        # Sample queries
        st.header("💡 Try These Queries")
        sample_queries = [
            "Count efficiency by DPD bucket",
            "Call connectivity by region",
            "PTP generation by POS band",
            "Amount efficiency by allocation",
            "State wise efficiency in South"
        ]
        for sample in sample_queries:
            if st.button(sample, key=f"sample_{sample}", use_container_width=True):
                # Save current thread if exists
                if st.session_state.current_thread:
                    thread_data = {
                        'messages': st.session_state.current_thread.copy(),
                        'last_result': st.session_state.last_result,
                        'confirmed_logic': st.session_state.confirmed_logic,
                        'confirmed_filters': st.session_state.confirmed_filters,
                        'last_generated_code': st.session_state.last_generated_code
                    }
                    st.session_state.thread_history.insert(0, thread_data)
                    st.session_state.thread_history = st.session_state.thread_history[:5]
                # Start fresh
                st.session_state.current_thread = []
                st.session_state.current_query = sample
                st.session_state.preview_data = None
                st.session_state.last_result = None
                st.session_state.confirmed_logic = None
                st.session_state.confirmed_filters = []
                st.session_state.last_generated_code = None
                st.session_state.active_thread_index = None
                st.rerun()

    # ==========================================================================
    # MAIN AREA - Chat Thread
    # ==========================================================================

    # Display conversation history
    if st.session_state.current_thread:
        for msg_idx, msg in enumerate(st.session_state.current_thread):
            with st.chat_message(msg['role']):
                st.write(msg['content'])
                if msg.get('result') is not None:
                    result_df = msg['result']
                    st.dataframe(
                        style_dataframe(result_df),
                        use_container_width=True,
                        hide_index=True
                    )
                    # Download buttons for each result in thread
                    col1, col2, col3 = st.columns([1, 1, 4])
                    with col1:
                        excel_data = export_to_excel(result_df)
                        st.download_button(
                            label="📥 Excel",
                            data=excel_data,
                            file_name=f"result_{msg_idx}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
                            mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            key=f"excel_thread_{msg_idx}"
                        )
                    with col2:
                        csv_data = export_to_csv(result_df)
                        st.download_button(
                            label="📥 CSV",
                            data=csv_data,
                            file_name=f"result_{msg_idx}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                            mime="text/csv",
                            key=f"csv_thread_{msg_idx}"
                        )

    # Display last result if exists and no preview is pending
    if st.session_state.last_result is not None and st.session_state.preview_data is None:
        result_df = st.session_state.last_result

        # Show result count
        st.success(f"Found {len(result_df)} results")

        # Display styled dataframe
        st.dataframe(
            style_dataframe(result_df),
            use_container_width=True,
            hide_index=True
        )

        # Action buttons - Download options
        col1, col2, col3, col4 = st.columns([1, 1, 1, 2])
        with col1:
            excel_data = export_to_excel(result_df)
            st.download_button(
                label="📥 Excel",
                data=excel_data,
                file_name=f"query_result_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )
        with col2:
            csv_data = export_to_csv(result_df)
            st.download_button(
                label="📥 CSV",
                data=csv_data,
                file_name=f"query_result_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv",
                mime="text/csv"
            )

        # Show generated code (Python and SQL)
        if st.session_state.last_generated_code:
            with st.expander("View Generated Code", expanded=False):
                code_data = st.session_state.last_generated_code
                if isinstance(code_data, dict):
                    tab1, tab2 = st.tabs(["Python", "SQL"])
                    with tab1:
                        st.code(code_data.get('python', ''), language="python")
                    with tab2:
                        st.code(code_data.get('sql', 'SQL not generated'), language="sql")
                else:
                    st.code(code_data, language="python")

        # Show current logic and filters for reference
        if st.session_state.confirmed_logic:
            with st.expander("Current Query Configuration", expanded=False):
                st.markdown("**Columns:**")
                logic_df = pd.DataFrame(st.session_state.confirmed_logic)
                st.dataframe(logic_df, use_container_width=True, hide_index=True)
                if st.session_state.confirmed_filters:
                    st.markdown("**Filters:**")
                    for f in st.session_state.confirmed_filters:
                        st.markdown(f"- {f}")

    # ==========================================================================
    # STEP 1: Parse query into preview (First LLM call) or modify existing logic
    # ==========================================================================
    if st.session_state.current_query and st.session_state.preview_data is None:
        query = st.session_state.current_query

        # Check if this is a follow-up (we have existing logic and results)
        if st.session_state.confirmed_logic and st.session_state.last_result is not None:
            # This is a follow-up message - modify existing logic
            with st.spinner("Updating query based on your feedback..."):
                try:
                    # Add to thread
                    st.session_state.current_thread.append({
                        'role': 'user',
                        'content': query
                    })

                    # Modify the logic
                    updated_logic = modify_logic_with_followup(
                        st.session_state.confirmed_logic,
                        query,
                        df
                    )

                    # Create preview data from updated logic
                    st.session_state.preview_data = {
                        'grouping_column': updated_logic[0].get('Column', '') if updated_logic else '',
                        'output_columns': [{'name': col.get('Column', ''), 'logic': col.get('Logic', '')} for col in updated_logic],
                        'row_labels': ['(will be determined)', 'Grand Total'],
                        'filters': [],
                        'sort_by': 'Conversion Rate',
                        'sort_ascending': False
                    }
                    st.session_state.pending_query = query
                    st.session_state.current_query = None
                    # Clear last_result so preview shows
                    st.session_state.last_result = None
                    st.rerun()

                except Exception as e:
                    st.error(f"Error updating query: {str(e)}")
                    st.session_state.current_query = None
        else:
            # This is a new query
            with st.spinner("Analyzing your query..."):
                try:
                    # Add to thread
                    st.session_state.current_thread.append({
                        'role': 'user',
                        'content': query
                    })

                    # First LLM call - get preview structure
                    preview_data = parse_query_to_preview(query, preview_system_prompt)
                    st.session_state.preview_data = preview_data
                    st.session_state.pending_query = query
                    st.session_state.current_query = None
                    st.rerun()

                except ValueError as e:
                    st.error(f"Failed to parse query: {str(e)}")
                    st.session_state.current_query = None
                except Exception as e:
                    st.error(f"Error analyzing query: {str(e)}")
                    st.session_state.current_query = None

    # ==========================================================================
    # STEP 2: Show Preview and Editable Logic Table
    # ==========================================================================
    if st.session_state.preview_data is not None and st.session_state.last_result is None:
        preview_data = st.session_state.preview_data
        pending_query = st.session_state.pending_query

        st.subheader(f"📝 Query: \"{pending_query}\"")

        # Show output structure preview
        st.markdown("### Output Structure Preview")
        st.caption("This is what your result table will look like:")

        preview_table = create_preview_table(preview_data)
        st.dataframe(preview_table, use_container_width=True, hide_index=True)

        # Show filters if any
        if preview_data.get('filters'):
            st.markdown("**Filters:**")
            for f in preview_data['filters']:
                st.markdown(f"- {f}")

        st.divider()

        # Show editable logic table
        st.markdown("### Column Logic")
        st.caption("Define how each column is calculated. Add, edit, or remove columns as needed.")

        logic_table = create_logic_table(preview_data)

        # Use data_editor with ability to add/remove rows
        edited_logic = st.data_editor(
            logic_table,
            use_container_width=True,
            hide_index=True,
            num_rows="dynamic",
            key="logic_editor"
        )

        st.divider()

        # Show editable filters
        st.markdown("### Filters")
        st.caption("Add filters to narrow down the data before analysis.")

        # Create filters table from preview_data or empty
        existing_filters = preview_data.get('filters', [])
        if existing_filters:
            filters_data = [{'Filter': str(f)} for f in existing_filters]
        else:
            filters_data = []

        # Create DataFrame with explicit string dtype
        filters_df = pd.DataFrame(filters_data, columns=['Filter']) if filters_data else pd.DataFrame({'Filter': pd.Series([], dtype='str')})

        edited_filters = st.data_editor(
            filters_df,
            use_container_width=True,
            hide_index=True,
            num_rows="dynamic",
            key="filters_editor",
            column_config={
                'Filter': st.column_config.TextColumn(
                    'Filter',
                    help='Examples: "last 15 days", "Region = South", "DPD > 300", "State in (Karnataka, Tamil Nadu)"',
                    width="large"
                )
            }
        )

        # Show filter examples
        with st.expander("Filter Examples", expanded=False):
            st.markdown("""
            - **Allocation filter**: `exclude Allocation Name = DEALLOCATED`
            - **Region filter**: `Region = South`, `Region in (North, West)`
            - **State filter**: `State = Karnataka`, `State in (Maharashtra, Gujarat)`
            - **DPD filter**: `DPD > 500`, `DPD between 360 and 720`
            - **POS filter**: `POS > 10000`, `Principal Balance Amount < 50000`
            - **Status filter**: `Status = COLLECTED`, `Status = PENDING`
            - **Loan Product**: `Loan Product = BL`
            - **Exclusions**: `exclude Allocation Name = DEALLOCATED`, `Agent Name is not null`
            """)

        st.divider()

        # Run button
        col1, col2, col3 = st.columns([1, 1, 3])
        with col1:
            if st.button("▶️ Run Query", type="primary", use_container_width=True):
                st.session_state.run_confirmed = True
                st.rerun()

        with col2:
            if st.button("❌ Cancel", use_container_width=True):
                st.session_state.preview_data = None
                st.session_state.pending_query = None
                st.rerun()

    # ==========================================================================
    # STEP 3: Execute confirmed query (Second LLM call)
    # ==========================================================================
    if st.session_state.run_confirmed and st.session_state.preview_data is not None:
        preview_data = st.session_state.preview_data
        pending_query = st.session_state.pending_query

        # Get the edited logic from the data editor
        logic_key = "logic_editor"
        if logic_key in st.session_state:
            edited_data = st.session_state[logic_key]
            # Handle both DataFrame and dict formats
            if isinstance(edited_data, pd.DataFrame):
                confirmed_logic = edited_data.to_dict('records')
            elif isinstance(edited_data, dict):
                # This is the edit delta format - apply edits to original
                # Start with original data
                confirmed_logic = [{'Column': col.get('name', col.get('Column', '')),
                                   'Logic': col.get('logic', col.get('Logic', ''))}
                                  for col in preview_data['output_columns']]
                # Apply edits
                for idx, edits in edited_data.get('edited_rows', {}).items():
                    if idx < len(confirmed_logic):
                        confirmed_logic[idx].update(edits)
                # Add new rows
                for new_row in edited_data.get('added_rows', []):
                    if new_row.get('Column') and new_row.get('Logic'):
                        confirmed_logic.append(new_row)
                # Remove deleted rows (in reverse order to maintain indices)
                for idx in sorted(edited_data.get('deleted_rows', []), reverse=True):
                    if idx < len(confirmed_logic):
                        confirmed_logic.pop(idx)
            else:
                confirmed_logic = [{'Column': col.get('name', col.get('Column', '')),
                                   'Logic': col.get('logic', col.get('Logic', ''))}
                                  for col in preview_data['output_columns']]
        else:
            confirmed_logic = [{'Column': col.get('name', col.get('Column', '')),
                               'Logic': col.get('logic', col.get('Logic', ''))}
                              for col in preview_data['output_columns']]

        # Get the edited filters from the data editor
        filters_key = "filters_editor"
        confirmed_filters = []
        if filters_key in st.session_state:
            filters_data = st.session_state[filters_key]
            if isinstance(filters_data, pd.DataFrame):
                confirmed_filters = [row['Filter'] for row in filters_data.to_dict('records') if row.get('Filter')]
            elif isinstance(filters_data, dict):
                # Handle edit delta format
                original_filters = preview_data.get('filters', [])
                confirmed_filters = original_filters.copy()
                for new_row in filters_data.get('added_rows', []):
                    if new_row.get('Filter'):
                        confirmed_filters.append(new_row['Filter'])
                for idx in sorted(filters_data.get('deleted_rows', []), reverse=True):
                    if idx < len(confirmed_filters):
                        confirmed_filters.pop(idx)

        # Update preview_data with confirmed filters for code generation
        preview_data['filters'] = confirmed_filters

        with st.spinner("Generating and executing query..."):
            try:
                # Build the code generation prompt with confirmed logic
                code_gen_prompt = build_code_generation_prompt(df, pending_query, confirmed_logic, preview_data)

                # Second LLM call - generate pandas code and SQL
                generated = generate_pandas_code(
                    f"Generate code for: {pending_query}",
                    code_gen_prompt
                )

                # Execute the Python code
                result = execute_pandas_code(generated['python'], df)

                # Store result and generated code
                st.session_state.last_result = result
                st.session_state.last_generated_code = generated
                st.session_state.confirmed_logic = confirmed_logic
                st.session_state.confirmed_filters = confirmed_filters
                st.session_state.preview_data = None
                st.session_state.pending_query = None
                st.session_state.run_confirmed = False

                # Add assistant response to thread
                st.session_state.current_thread.append({
                    'role': 'assistant',
                    'content': f"Here are your results ({len(result)} rows):",
                    'result': result
                })

                # Rerun to display results
                st.rerun()

            except ValueError as e:
                st.error(f"API error: {str(e)}")
                if 'generated' in dir() and generated:
                    with st.expander("Generated Code (Debug)", expanded=True):
                        st.code(generated.get('python', ''), language="python")
                st.session_state.run_confirmed = False
            except Exception as e:
                st.error(f"Query failed: {str(e)}")
                if 'generated' in dir() and generated:
                    with st.expander("Generated Code (Debug)", expanded=True):
                        st.code(generated.get('python', ''), language="python")
                st.session_state.run_confirmed = False

    # Chat input at the bottom
    st.divider()

    # Determine placeholder text based on state
    if st.session_state.last_result is not None:
        placeholder = "Continue the conversation... (e.g., 'add IVR cost column', 'change buckets to 200-500, 500+')"
    else:
        placeholder = "Ask me anything about your collections data..."

    user_input = st.chat_input(placeholder)

    if user_input:
        st.session_state.current_query = user_input
        st.session_state.preview_data = None
        # Don't clear last_result or confirmed_logic - needed for follow-ups
        st.session_state.pending_query = None
        st.session_state.run_confirmed = False
        st.rerun()


if __name__ == "__main__":
    main()
