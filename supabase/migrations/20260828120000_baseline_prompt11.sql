-- Baseline schema: state of the database as built through Prompt 11
-- of the consolidation build pack. Reconstructed from the live project
-- (dcwrltyqzkgzcnhjxrej) on 2026-08-28; no migration history existed
-- because all prior SQL was pasted straight into the Supabase SQL editor.
--
-- This file is a RECORD and a rebuild script for a fresh project. It is
-- already applied to the live database - do not re-run it there.

-- ======================================================================
-- EXTENSIONS
-- ======================================================================

create extension if not exists "pgcrypto";

-- ======================================================================
-- SEQUENCES
-- ======================================================================

create sequence if not exists public.fact_balances_id_seq;
create sequence if not exists public.ic_reconciliation_id_seq;
create sequence if not exists public.journal_header_doc_number_seq;
create sequence if not exists public.stg_upload_id_seq;

-- ======================================================================
-- TABLES
-- ======================================================================

create table if not exists public.app_user (
  id uuid not null,
  tenant_id uuid not null,
  email text not null,
  role text default 'preparer'::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.cons_group_member (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  cons_group_id uuid not null,
  entity_id uuid not null,
  cons_method text not null,
  direct_ownership_pct numeric(9,6) default 100 not null,
  group_share_pct numeric(9,6) default 100 not null,
  minority_pct numeric(9,6) generated always as (((100)::numeric - group_share_pct)) stored,
  first_cons_year integer,
  first_cons_period integer,
  last_cons_year integer,
  last_cons_period integer
);

create table if not exists public.dim_account (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  statement_type text not null,
  account_class text not null,
  normal_balance character(1) not null,
  requires_partner boolean default false,
  requires_movement boolean default false,
  is_intercompany boolean default false,
  elimination_group text,
  translation_method text default 'CLOSING'::text,
  is_investment_account boolean default false,
  is_equity_account boolean default false,
  is_retained_earnings boolean default false,
  is_net_income boolean default false,
  is_active boolean default true,
  attributes jsonb default '{}'::jsonb
);

create table if not exists public.dim_cons_group (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  group_currency character(3) not null,
  parent_group_id uuid,
  is_active boolean default true
);

create table if not exists public.dim_currency (
  code character(3) not null,
  name text not null,
  decimals integer default 2
);

create table if not exists public.dim_entity (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  local_currency character(3) not null,
  country character(2),
  entity_type text default 'SUBSIDIARY'::text,
  default_cons_method text default 'PURCHASE'::text,
  acquisition_date date,
  divestment_date date,
  is_active boolean default true,
  attributes jsonb default '{}'::jsonb
);

create table if not exists public.dim_generic_member (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  dim_code text not null,
  code text not null,
  name text not null,
  parent_code text,
  is_active boolean default true,
  attributes jsonb default '{}'::jsonb
);

create table if not exists public.dim_hierarchy (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  dim_code text not null,
  hierarchy_code text not null,
  hierarchy_name text not null
);

create table if not exists public.dim_hierarchy_node (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  hierarchy_id uuid not null,
  member_code text not null,
  parent_member_code text,
  node_order integer default 100,
  aggregation_sign smallint default 1
);

create table if not exists public.dim_movement (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  movement_class text not null,
  is_bcf_target boolean default false,
  is_bcf_source boolean default false,
  cash_flow_relevant boolean default false,
  display_order integer default 100
);

create table if not exists public.dim_registry (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  dim_code text not null,
  dim_name text not null,
  is_mandatory boolean default false not null,
  is_active boolean default false not null,
  physical_column text not null,
  master_table text,
  is_hierarchical boolean default true,
  requires_partner boolean default false,
  display_order integer default 100,
  created_at timestamp with time zone default now()
);

create table if not exists public.dim_version (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  version_type text default 'ACTUAL'::text,
  is_locked boolean default false,
  copy_source_version uuid
);

create table if not exists public.fact_balances (
  id bigint default nextval('fact_balances_id_seq'::regclass) not null,
  tenant_id uuid not null,
  entity_id uuid not null,
  account_id uuid not null,
  movement_id uuid,
  partner_id uuid,
  cons_group_id uuid,
  version_id uuid not null,
  fiscal_year integer not null,
  period integer not null,
  posting_level character(2) default '00'::bpchar not null,
  zdim01 text,
  zdim02 text,
  zdim03 text,
  zdim04 text,
  zdim05 text,
  zdim06 text,
  zdim07 text,
  zdim08 text,
  zdim09 text,
  zdim10 text,
  transaction_currency character(3),
  local_currency character(3) not null,
  group_currency character(3) not null,
  amount_tc numeric(23,2) default 0,
  amount_lc numeric(23,2) default 0 not null,
  amount_gc numeric(23,2) default 0 not null,
  quantity numeric(23,3) default 0,
  journal_id uuid,
  task_run_id uuid,
  source_task text default 'UPLOAD'::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.fx_rate (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  rate_type text not null,
  from_currency character(3) not null,
  to_currency character(3) not null,
  fiscal_year integer not null,
  period integer not null,
  rate numeric(18,8) not null,
  version_id uuid
);

create table if not exists public.historical_rate (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  entity_id uuid not null,
  account_id uuid not null,
  movement_id uuid,
  rate numeric(18,8) not null,
  valid_from_year integer,
  valid_from_period integer
);

create table if not exists public.ic_reconciliation (
  id bigint default nextval('ic_reconciliation_id_seq'::regclass) not null,
  tenant_id uuid not null,
  task_run_id uuid,
  cons_group_id uuid,
  fiscal_year integer,
  period integer,
  version_id uuid,
  entity_id uuid,
  partner_id uuid,
  rule_id uuid,
  leg1_amount_gc numeric(23,2),
  leg2_amount_gc numeric(23,2),
  difference_gc numeric(23,2),
  status text
);

create table if not exists public.investment_register (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  cons_group_id uuid not null,
  investor_entity_id uuid not null,
  investee_entity_id uuid not null,
  activity text not null,
  fiscal_year integer not null,
  period integer not null,
  cons_method text not null,
  ownership_pct_before numeric(9,6) default 0,
  ownership_pct_after numeric(9,6) not null,
  investment_cost_gc numeric(23,2),
  fair_value_adjustment_gc numeric(23,2) default 0,
  net_assets_acquired_gc numeric(23,2),
  goodwill_gc numeric(23,2),
  nci_measurement text default 'PROPORTIONATE'::text,
  is_posted boolean default false,
  notes text
);

create table if not exists public.journal_header (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  doc_number bigint default nextval('journal_header_doc_number_seq'::regclass) not null,
  doc_type text not null,
  posting_level character(2) not null,
  fiscal_year integer not null,
  period integer not null,
  version_id uuid not null,
  cons_group_id uuid,
  task_run_id uuid,
  description text,
  is_reversed boolean default false,
  reversed_by uuid,
  created_by uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.period_status (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  fiscal_year integer not null,
  period integer not null,
  version_id uuid not null,
  cons_group_id uuid,
  status text default 'OPEN'::text not null
);

create table if not exists public.rule_bcf (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  source_account_filter jsonb default '{}'::jsonb,
  source_movement_class text[] default ARRAY['CLOSING'::text],
  target_movement_code text not null,
  carry_partner boolean default true,
  carry_custom_dims boolean default true,
  pl_to_retained_earnings boolean default false,
  retained_earnings_account_code text,
  sequence integer default 100,
  is_active boolean default true
);

create table if not exists public.rule_coi (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  cons_method text not null,
  investment_account_code text not null,
  equity_account_filter jsonb not null,
  goodwill_account_code text,
  badwill_account_code text,
  nci_equity_account_code text,
  nci_pl_account_code text,
  equity_pickup_account_code text,
  equity_income_account_code text,
  goodwill_amortisation_account_code text,
  posting_level character(2) default '20'::bpchar,
  sequence integer default 100,
  is_active boolean default true
);

create table if not exists public.rule_ic_elim (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  elimination_group text not null,
  leg1_account_filter jsonb not null,
  leg2_account_filter jsonb not null,
  match_on text[] default ARRAY['entity'::text, 'partner'::text],
  is_two_sided boolean default true,
  difference_threshold_abs numeric(23,2) default 0,
  difference_threshold_pct numeric(9,4) default 0,
  currency_diff_account_code text,
  real_diff_account_code text,
  posting_level character(2) default '10'::bpchar,
  post_in_currency text default 'GC'::text,
  sequence integer default 100,
  is_active boolean default true
);

create table if not exists public.rule_net_income (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  source_account_filter jsonb default '{"statement_type": ["PL"]}'::jsonb,
  target_bs_account_code text not null,
  target_movement_code text,
  split_to_minority boolean default true,
  minority_account_code text,
  sequence integer default 100,
  is_active boolean default true
);

create table if not exists public.rule_translation (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  account_filter jsonb default '{}'::jsonb,
  rate_type text not null,
  historical_rate_source text default 'ACQUISITION'::text,
  post_difference_to text,
  difference_scope text default 'BS'::text,
  sequence integer default 100,
  is_active boolean default true
);

create table if not exists public.stg_upload (
  id bigint default nextval('stg_upload_id_seq'::regclass) not null,
  tenant_id uuid not null,
  batch_id uuid not null,
  row_no integer not null,
  raw jsonb not null,
  entity_code text,
  account_code text,
  movement_code text,
  partner_code text,
  zdim01 text,
  zdim02 text,
  zdim03 text,
  zdim04 text,
  zdim05 text,
  zdim06 text,
  zdim07 text,
  zdim08 text,
  zdim09 text,
  zdim10 text,
  amount_lc numeric(23,2),
  amount_tc numeric(23,2),
  transaction_currency character(3),
  status text default 'PENDING'::text,
  error_msg text
);

create table if not exists public.task_run (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  workflow_run_id uuid,
  step_id uuid,
  task_type text not null,
  entity_id uuid,
  cons_group_id uuid,
  version_id uuid,
  fiscal_year integer,
  period integer,
  status text default 'PENDING'::text,
  rows_written integer default 0,
  journal_id uuid,
  message text,
  log jsonb default '[]'::jsonb,
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  run_by uuid
);

create table if not exists public.tenant (
  id uuid default gen_random_uuid() not null,
  name text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.upload_batch (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  file_name text,
  storage_path text,
  mapping_id uuid,
  entity_id uuid,
  version_id uuid,
  fiscal_year integer,
  period integer,
  row_count integer default 0,
  valid_count integer default 0,
  error_count integer default 0,
  status text default 'UPLOADED'::text,
  journal_id uuid,
  created_by uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.upload_mapping (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  column_map jsonb default '{}'::jsonb not null,
  value_map jsonb default '{}'::jsonb not null,
  default_values jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.workflow_run (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  template_id uuid not null,
  cons_group_id uuid,
  version_id uuid not null,
  fiscal_year integer not null,
  period integer not null,
  status text default 'NOT_STARTED'::text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  started_by uuid
);

create table if not exists public.workflow_step (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  template_id uuid not null,
  step_no integer not null,
  task_type text not null,
  name text not null,
  scope text default 'ENTITY'::text not null,
  is_blocking boolean default true,
  requires_approval boolean default false,
  depends_on_step_no integer[],
  parameters jsonb default '{}'::jsonb
);

create table if not exists public.workflow_template (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null,
  code text not null,
  name text not null,
  is_active boolean default true
);

-- ======================================================================
-- CONSTRAINTS (primary keys, unique, check, foreign keys)
-- ======================================================================

alter table public.app_user add constraint app_user_pkey PRIMARY KEY (id);
alter table public.cons_group_member add constraint cons_group_member_pkey PRIMARY KEY (id);
alter table public.dim_account add constraint dim_account_pkey PRIMARY KEY (id);
alter table public.dim_cons_group add constraint dim_cons_group_pkey PRIMARY KEY (id);
alter table public.dim_currency add constraint dim_currency_pkey PRIMARY KEY (code);
alter table public.dim_entity add constraint dim_entity_pkey PRIMARY KEY (id);
alter table public.dim_generic_member add constraint dim_generic_member_pkey PRIMARY KEY (id);
alter table public.dim_hierarchy add constraint dim_hierarchy_pkey PRIMARY KEY (id);
alter table public.dim_hierarchy_node add constraint dim_hierarchy_node_pkey PRIMARY KEY (id);
alter table public.dim_movement add constraint dim_movement_pkey PRIMARY KEY (id);
alter table public.dim_registry add constraint dim_registry_pkey PRIMARY KEY (id);
alter table public.dim_version add constraint dim_version_pkey PRIMARY KEY (id);
alter table public.fact_balances add constraint fact_balances_pkey PRIMARY KEY (id);
alter table public.fx_rate add constraint fx_rate_pkey PRIMARY KEY (id);
alter table public.historical_rate add constraint historical_rate_pkey PRIMARY KEY (id);
alter table public.ic_reconciliation add constraint ic_reconciliation_pkey PRIMARY KEY (id);
alter table public.investment_register add constraint investment_register_pkey PRIMARY KEY (id);
alter table public.journal_header add constraint journal_header_pkey PRIMARY KEY (id);
alter table public.period_status add constraint period_status_pkey PRIMARY KEY (id);
alter table public.rule_bcf add constraint rule_bcf_pkey PRIMARY KEY (id);
alter table public.rule_coi add constraint rule_coi_pkey PRIMARY KEY (id);
alter table public.rule_ic_elim add constraint rule_ic_elim_pkey PRIMARY KEY (id);
alter table public.rule_net_income add constraint rule_net_income_pkey PRIMARY KEY (id);
alter table public.rule_translation add constraint rule_translation_pkey PRIMARY KEY (id);
alter table public.stg_upload add constraint stg_upload_pkey PRIMARY KEY (id);
alter table public.task_run add constraint task_run_pkey PRIMARY KEY (id);
alter table public.tenant add constraint tenant_pkey PRIMARY KEY (id);
alter table public.upload_batch add constraint upload_batch_pkey PRIMARY KEY (id);
alter table public.upload_mapping add constraint upload_mapping_pkey PRIMARY KEY (id);
alter table public.workflow_run add constraint workflow_run_pkey PRIMARY KEY (id);
alter table public.workflow_step add constraint workflow_step_pkey PRIMARY KEY (id);
alter table public.workflow_template add constraint workflow_template_pkey PRIMARY KEY (id);
alter table public.cons_group_member add constraint cons_group_member_tenant_id_cons_group_id_entity_id_key UNIQUE (tenant_id, cons_group_id, entity_id);
alter table public.dim_account add constraint dim_account_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.dim_cons_group add constraint dim_cons_group_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.dim_entity add constraint dim_entity_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.dim_generic_member add constraint dim_generic_member_tenant_id_dim_code_code_key UNIQUE (tenant_id, dim_code, code);
alter table public.dim_hierarchy add constraint dim_hierarchy_tenant_id_dim_code_hierarchy_code_key UNIQUE (tenant_id, dim_code, hierarchy_code);
alter table public.dim_hierarchy_node add constraint dim_hierarchy_node_tenant_id_hierarchy_id_member_code_key UNIQUE (tenant_id, hierarchy_id, member_code);
alter table public.dim_movement add constraint dim_movement_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.dim_registry add constraint dim_registry_tenant_id_dim_code_key UNIQUE (tenant_id, dim_code);
alter table public.dim_registry add constraint dim_registry_tenant_id_physical_column_key UNIQUE (tenant_id, physical_column);
alter table public.dim_version add constraint dim_version_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.fx_rate add constraint fx_rate_tenant_id_rate_type_from_currency_to_currency_fisca_key UNIQUE (tenant_id, rate_type, from_currency, to_currency, fiscal_year, period, version_id);
alter table public.period_status add constraint period_status_tenant_id_fiscal_year_period_version_id_cons__key UNIQUE (tenant_id, fiscal_year, period, version_id, cons_group_id);
alter table public.rule_bcf add constraint rule_bcf_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.rule_coi add constraint rule_coi_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.rule_ic_elim add constraint rule_ic_elim_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.rule_net_income add constraint rule_net_income_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.rule_translation add constraint rule_translation_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.upload_mapping add constraint upload_mapping_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.workflow_step add constraint workflow_step_template_id_step_no_key UNIQUE (template_id, step_no);
alter table public.workflow_template add constraint workflow_template_tenant_id_code_key UNIQUE (tenant_id, code);
alter table public.app_user add constraint app_user_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'preparer'::text, 'reviewer'::text, 'viewer'::text])));
alter table public.cons_group_member add constraint cons_group_member_cons_method_check CHECK ((cons_method = ANY (ARRAY['PURCHASE'::text, 'PROPORTIONATE'::text, 'EQUITY'::text, 'NONE'::text])));
alter table public.dim_account add constraint dim_account_account_class_check CHECK ((account_class = ANY (ARRAY['ASSET'::text, 'LIABILITY'::text, 'EQUITY'::text, 'INCOME'::text, 'EXPENSE'::text, 'STATISTICAL'::text])));
alter table public.dim_account add constraint dim_account_normal_balance_check CHECK ((normal_balance = ANY (ARRAY['D'::bpchar, 'C'::bpchar])));
alter table public.dim_account add constraint dim_account_statement_type_check CHECK ((statement_type = ANY (ARRAY['BS'::text, 'PL'::text, 'OCI'::text, 'CF'::text, 'STAT'::text])));
alter table public.dim_account add constraint dim_account_translation_method_check CHECK ((translation_method = ANY (ARRAY['CLOSING'::text, 'AVERAGE'::text, 'HISTORICAL'::text, 'NONE'::text])));
alter table public.dim_entity add constraint dim_entity_default_cons_method_check CHECK ((default_cons_method = ANY (ARRAY['PURCHASE'::text, 'PROPORTIONATE'::text, 'EQUITY'::text, 'NONE'::text])));
alter table public.dim_entity add constraint dim_entity_entity_type_check CHECK ((entity_type = ANY (ARRAY['PARENT'::text, 'SUBSIDIARY'::text, 'JV'::text, 'ASSOCIATE'::text, 'ELIMINATION'::text, 'ADJUSTMENT'::text])));
alter table public.dim_hierarchy_node add constraint dim_hierarchy_node_aggregation_sign_check CHECK ((aggregation_sign = ANY (ARRAY[1, '-1'::integer, 0])));
alter table public.dim_movement add constraint dim_movement_movement_class_check CHECK ((movement_class = ANY (ARRAY['OPENING'::text, 'ADDITION'::text, 'DISPOSAL'::text, 'TRANSFER'::text, 'FX_EFFECT'::text, 'SCOPE_CHANGE'::text, 'REVALUATION'::text, 'CLOSING'::text])));
alter table public.dim_version add constraint dim_version_version_type_check CHECK ((version_type = ANY (ARRAY['ACTUAL'::text, 'BUDGET'::text, 'FORECAST'::text, 'SIMULATION'::text, 'RESTATED'::text])));
alter table public.fact_balances add constraint fact_balances_period_check CHECK (((period >= 0) AND (period <= 16)));
alter table public.fx_rate add constraint fx_rate_period_check CHECK (((period >= 0) AND (period <= 16)));
alter table public.fx_rate add constraint fx_rate_rate_type_check CHECK ((rate_type = ANY (ARRAY['CLOSING'::text, 'AVERAGE'::text, 'HISTORICAL'::text, 'OPENING'::text])));
alter table public.ic_reconciliation add constraint ic_reconciliation_status_check CHECK ((status = ANY (ARRAY['MATCHED'::text, 'WITHIN_TOLERANCE'::text, 'DIFFERENCE'::text, 'ONE_SIDED'::text])));
alter table public.investment_register add constraint investment_register_activity_check CHECK ((activity = ANY (ARRAY['FIRST_CONSOLIDATION'::text, 'SUBSEQUENT'::text, 'STEP_ACQUISITION'::text, 'PARTIAL_DISPOSAL'::text, 'TOTAL_DISPOSAL'::text, 'METHOD_CHANGE'::text, 'CAPITAL_INCREASE'::text, 'DISTRIBUTION'::text])));
alter table public.investment_register add constraint investment_register_cons_method_check CHECK ((cons_method = ANY (ARRAY['PURCHASE'::text, 'PROPORTIONATE'::text, 'EQUITY'::text])));
alter table public.investment_register add constraint investment_register_nci_measurement_check CHECK ((nci_measurement = ANY (ARRAY['PROPORTIONATE'::text, 'FULL_GOODWILL'::text])));
alter table public.journal_header add constraint journal_header_doc_type_check CHECK ((doc_type = ANY (ARRAY['UPLOAD'::text, 'MANUAL'::text, 'BCF'::text, 'NETINCOME'::text, 'TRANSLATION'::text, 'IC_ELIM'::text, 'COI'::text, 'REVERSAL'::text])));
alter table public.period_status add constraint period_status_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'SUBMITTED'::text, 'LOCKED'::text, 'CLOSED'::text])));
alter table public.rule_coi add constraint rule_coi_cons_method_check CHECK ((cons_method = ANY (ARRAY['PURCHASE'::text, 'PROPORTIONATE'::text, 'EQUITY'::text])));
alter table public.rule_ic_elim add constraint rule_ic_elim_post_in_currency_check CHECK ((post_in_currency = ANY (ARRAY['GC'::text, 'LC'::text, 'BOTH'::text])));
alter table public.rule_translation add constraint rule_translation_difference_scope_check CHECK ((difference_scope = ANY (ARRAY['BS'::text, 'PL'::text, 'EQUITY'::text])));
alter table public.rule_translation add constraint rule_translation_rate_type_check CHECK ((rate_type = ANY (ARRAY['CLOSING'::text, 'AVERAGE'::text, 'HISTORICAL'::text, 'OPENING'::text])));
alter table public.stg_upload add constraint stg_upload_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'VALID'::text, 'ERROR'::text, 'POSTED'::text])));
alter table public.task_run add constraint task_run_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'RUNNING'::text, 'SUCCESS'::text, 'WARNING'::text, 'ERROR'::text, 'REVERSED'::text])));
alter table public.upload_batch add constraint upload_batch_status_check CHECK ((status = ANY (ARRAY['UPLOADED'::text, 'VALIDATED'::text, 'POSTED'::text, 'FAILED'::text, 'REVERSED'::text])));
alter table public.workflow_run add constraint workflow_run_status_check CHECK ((status = ANY (ARRAY['NOT_STARTED'::text, 'RUNNING'::text, 'COMPLETED'::text, 'FAILED'::text, 'PARTIAL'::text])));
alter table public.workflow_step add constraint workflow_step_scope_check CHECK ((scope = ANY (ARRAY['ENTITY'::text, 'GROUP'::text])));
alter table public.workflow_step add constraint workflow_step_task_type_check CHECK ((task_type = ANY (ARRAY['DATA_UPLOAD'::text, 'VALIDATION'::text, 'BCF'::text, 'NET_INCOME'::text, 'TRANSLATION'::text, 'IC_RECON'::text, 'IC_ELIM'::text, 'COI'::text, 'MANUAL_ADJ'::text, 'GROUP_REPORT'::text, 'LOCK_PERIOD'::text])));
alter table public.app_user add constraint app_user_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.app_user add constraint app_user_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.cons_group_member add constraint cons_group_member_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id) ON DELETE CASCADE;
alter table public.cons_group_member add constraint cons_group_member_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES dim_entity(id);
alter table public.cons_group_member add constraint cons_group_member_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_account add constraint dim_account_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_cons_group add constraint dim_cons_group_parent_group_id_fkey FOREIGN KEY (parent_group_id) REFERENCES dim_cons_group(id);
alter table public.dim_cons_group add constraint dim_cons_group_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_entity add constraint dim_entity_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_generic_member add constraint dim_generic_member_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_hierarchy add constraint dim_hierarchy_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_hierarchy_node add constraint dim_hierarchy_node_hierarchy_id_fkey FOREIGN KEY (hierarchy_id) REFERENCES dim_hierarchy(id) ON DELETE CASCADE;
alter table public.dim_hierarchy_node add constraint dim_hierarchy_node_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_movement add constraint dim_movement_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_registry add constraint dim_registry_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.dim_version add constraint dim_version_copy_source_version_fkey FOREIGN KEY (copy_source_version) REFERENCES dim_version(id);
alter table public.dim_version add constraint dim_version_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.fact_balances add constraint fact_balances_account_id_fkey FOREIGN KEY (account_id) REFERENCES dim_account(id);
alter table public.fact_balances add constraint fact_balances_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id);
alter table public.fact_balances add constraint fact_balances_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES dim_entity(id);
alter table public.fact_balances add constraint fact_balances_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES journal_header(id) ON DELETE CASCADE;
alter table public.fact_balances add constraint fact_balances_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES dim_movement(id);
alter table public.fact_balances add constraint fact_balances_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES dim_entity(id);
alter table public.fact_balances add constraint fact_balances_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.fact_balances add constraint fact_balances_version_id_fkey FOREIGN KEY (version_id) REFERENCES dim_version(id);
alter table public.fx_rate add constraint fx_rate_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.fx_rate add constraint fx_rate_version_id_fkey FOREIGN KEY (version_id) REFERENCES dim_version(id);
alter table public.historical_rate add constraint historical_rate_account_id_fkey FOREIGN KEY (account_id) REFERENCES dim_account(id);
alter table public.historical_rate add constraint historical_rate_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES dim_entity(id);
alter table public.historical_rate add constraint historical_rate_movement_id_fkey FOREIGN KEY (movement_id) REFERENCES dim_movement(id);
alter table public.historical_rate add constraint historical_rate_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.ic_reconciliation add constraint ic_reconciliation_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES rule_ic_elim(id);
alter table public.investment_register add constraint investment_register_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id);
alter table public.investment_register add constraint investment_register_investee_entity_id_fkey FOREIGN KEY (investee_entity_id) REFERENCES dim_entity(id);
alter table public.investment_register add constraint investment_register_investor_entity_id_fkey FOREIGN KEY (investor_entity_id) REFERENCES dim_entity(id);
alter table public.investment_register add constraint investment_register_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.journal_header add constraint journal_header_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id);
alter table public.journal_header add constraint journal_header_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
alter table public.journal_header add constraint journal_header_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES journal_header(id);
alter table public.journal_header add constraint journal_header_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.journal_header add constraint journal_header_version_id_fkey FOREIGN KEY (version_id) REFERENCES dim_version(id);
alter table public.period_status add constraint period_status_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id);
alter table public.period_status add constraint period_status_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.period_status add constraint period_status_version_id_fkey FOREIGN KEY (version_id) REFERENCES dim_version(id);
alter table public.rule_bcf add constraint rule_bcf_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.rule_coi add constraint rule_coi_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.rule_ic_elim add constraint rule_ic_elim_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.rule_net_income add constraint rule_net_income_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.rule_translation add constraint rule_translation_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.stg_upload add constraint stg_upload_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.task_run add constraint task_run_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id);
alter table public.task_run add constraint task_run_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES dim_entity(id);
alter table public.task_run add constraint task_run_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES journal_header(id);
alter table public.task_run add constraint task_run_run_by_fkey FOREIGN KEY (run_by) REFERENCES app_user(id);
alter table public.task_run add constraint task_run_step_id_fkey FOREIGN KEY (step_id) REFERENCES workflow_step(id);
alter table public.task_run add constraint task_run_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.task_run add constraint task_run_workflow_run_id_fkey FOREIGN KEY (workflow_run_id) REFERENCES workflow_run(id) ON DELETE CASCADE;
alter table public.upload_batch add constraint upload_batch_created_by_fkey FOREIGN KEY (created_by) REFERENCES app_user(id);
alter table public.upload_batch add constraint upload_batch_entity_id_fkey FOREIGN KEY (entity_id) REFERENCES dim_entity(id);
alter table public.upload_batch add constraint upload_batch_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES journal_header(id);
alter table public.upload_batch add constraint upload_batch_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.upload_batch add constraint upload_batch_version_id_fkey FOREIGN KEY (version_id) REFERENCES dim_version(id);
alter table public.upload_mapping add constraint upload_mapping_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.workflow_run add constraint workflow_run_cons_group_id_fkey FOREIGN KEY (cons_group_id) REFERENCES dim_cons_group(id);
alter table public.workflow_run add constraint workflow_run_started_by_fkey FOREIGN KEY (started_by) REFERENCES app_user(id);
alter table public.workflow_run add constraint workflow_run_template_id_fkey FOREIGN KEY (template_id) REFERENCES workflow_template(id);
alter table public.workflow_run add constraint workflow_run_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.workflow_run add constraint workflow_run_version_id_fkey FOREIGN KEY (version_id) REFERENCES dim_version(id);
alter table public.workflow_step add constraint workflow_step_template_id_fkey FOREIGN KEY (template_id) REFERENCES workflow_template(id) ON DELETE CASCADE;
alter table public.workflow_step add constraint workflow_step_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);
alter table public.workflow_template add constraint workflow_template_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenant(id);

-- ======================================================================
-- INDEXES
-- ======================================================================

CREATE INDEX dim_hierarchy_node_hierarchy_id_parent_member_code_idx ON public.dim_hierarchy_node USING btree (hierarchy_id, parent_member_code);
CREATE INDEX fb_entity_acc ON public.fact_balances USING btree (tenant_id, entity_id, account_id, fiscal_year, period);
CREATE INDEX fb_group ON public.fact_balances USING btree (tenant_id, cons_group_id, version_id, fiscal_year, period);
CREATE INDEX fb_partner ON public.fact_balances USING btree (tenant_id, partner_id) WHERE (partner_id IS NOT NULL);
CREATE INDEX fb_slice ON public.fact_balances USING btree (tenant_id, version_id, fiscal_year, period, posting_level);
CREATE INDEX fb_taskrun ON public.fact_balances USING btree (task_run_id);
CREATE INDEX stg_upload_batch_id_status_idx ON public.stg_upload USING btree (batch_id, status);
CREATE INDEX task_run_workflow_run_id_status_idx ON public.task_run USING btree (workflow_run_id, status);

-- ======================================================================
-- FUNCTIONS
-- ======================================================================

CREATE OR REPLACE FUNCTION public.activate_data_model(p_dimensions jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_item jsonb;
  v_code text;
  v_name text;
  v_slot text;
  v_used text[];
  v_i int;
  v_result jsonb := '[]'::jsonb;
  v_keep text[] := array[]::text[];
  v_row record;
  v_has_data boolean;
begin
  if v_tenant is null then
    raise exception 'No tenant context for current user';
  end if;
  if p_dimensions is null or jsonb_typeof(p_dimensions) <> 'array' then
    raise exception 'p_dimensions must be a jsonb array';
  end if;
  if jsonb_array_length(p_dimensions) > 10 then
    raise exception 'At most 10 optional dimensions are supported';
  end if;

  -- slots already assigned to this tenant
  select coalesce(array_agg(physical_column), array[]::text[])
    into v_used
  from dim_registry
  where tenant_id = v_tenant and physical_column like 'zdim%';

  for v_item in select * from jsonb_array_elements(p_dimensions)
  loop
    v_code := upper(nullif(trim(v_item->>'code'), ''));
    v_name := coalesce(nullif(trim(v_item->>'name'), ''), v_code);
    if v_code is null then
      raise exception 'Every dimension needs a code';
    end if;
    v_keep := v_keep || v_code;

    -- reuse an existing slot when this dimension is already registered
    select physical_column into v_slot
    from dim_registry
    where tenant_id = v_tenant and dim_code = v_code;

    if v_slot is null then
      v_slot := null;
      for v_i in 1..10 loop
        if not (('zdim' || lpad(v_i::text, 2, '0')) = any (v_used)) then
          v_slot := 'zdim' || lpad(v_i::text, 2, '0');
          v_used := v_used || v_slot;
          exit;
        end if;
      end loop;
      if v_slot is null then
        raise exception 'No free zdim slot available for %', v_code;
      end if;
    end if;

    insert into dim_registry (
      tenant_id, dim_code, dim_name, is_mandatory, is_active,
      physical_column, master_table, is_hierarchical, requires_partner, display_order
    ) values (
      v_tenant, v_code, v_name, false, true,
      v_slot, 'dim_generic_member', true, false,
      100 + (substring(v_slot from 5))::int
    )
    on conflict (tenant_id, dim_code) do update
      set dim_name = excluded.dim_name,
          is_active = true,
          display_order = excluded.display_order;

    insert into dim_generic_member (tenant_id, dim_code, code, name, is_active)
    values (v_tenant, v_code, '#', 'Not Assigned', true)
    on conflict (tenant_id, dim_code, code) do nothing;

    v_result := v_result || jsonb_build_object('dim_code', v_code, 'physical_column', v_slot);
    v_slot := null;
  end loop;

  -- deactivate optional dimensions no longer selected, unless they carry fact data
  for v_row in
    select dim_code, physical_column
    from dim_registry
    where tenant_id = v_tenant
      and is_mandatory = false
      and is_active = true
      and physical_column like 'zdim%'
      and not (dim_code = any (v_keep))
  loop
    execute format(
      'select exists (select 1 from fact_balances where tenant_id = $1 and %I is not null and %I <> ''#'')',
      v_row.physical_column, v_row.physical_column
    ) into v_has_data using v_tenant;

    if not v_has_data then
      update dim_registry set is_active = false
      where tenant_id = v_tenant and dim_code = v_row.dim_code;
    end if;
  end loop;

  return jsonb_build_object('activated', v_result, 'activated_at', now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_period_open(p_tenant uuid, p_version uuid, p_year integer, p_period integer, p_cons_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_status text;
begin
  select ps.status into v_status
    from period_status ps
   where ps.tenant_id = p_tenant
     and ps.version_id = p_version
     and ps.fiscal_year = p_year
     and ps.period = p_period
     and (ps.cons_group_id is null or ps.cons_group_id = p_cons_group)
   order by (ps.cons_group_id is not null) desc
   limit 1;
  if v_status in ('LOCKED', 'CLOSED') then
    raise exception 'Period %/% is % for this version — posting is not allowed', p_year, p_period, v_status;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.create_model_fact_table(p_model_code text, p_dims text[])
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  v_table text := format('fact_%s', lower(p_model_code));
  v_cols  text := '';
  d text;
begin
  foreach d in array p_dims loop
    v_cols := v_cols || format('%I text, ', lower(d));
  end loop;

  execute format($ddl$
    create table if not exists %I (
      like fact_balances including defaults including constraints including indexes,
      %s dummy_col boolean
    )$ddl$, v_table, v_cols);

  execute format('alter table %I drop column dummy_col', v_table);
  execute format('alter table %I enable row level security', v_table);
  execute format($p$create policy tenant_isolation on %I
      using (tenant_id = current_tenant_id())
      with check (tenant_id = current_tenant_id())$p$, v_table);

  insert into model_registry (tenant_id, model_code, table_name, dimensions)
  values (current_tenant_id(), p_model_code, v_table, to_jsonb(p_dims));

  return v_table;
end $function$
;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
  select tenant_id from app_user where id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_journal_posting_level()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.posting_level = '01' and new.cons_group_id is not null then
    raise exception 'Posting level 01 must not carry a consolidation group';
  end if;
  if new.posting_level = '30' and new.cons_group_id is null then
    raise exception 'Posting level 30 requires a consolidation group';
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.enforce_posting_level()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.posting_level = '01' then
    if new.entity_id is null then
      raise exception 'Posting level 01 requires an entity';
    end if;
    if new.cons_group_id is not null then
      raise exception 'Posting level 01 must not carry a consolidation group';
    end if;
  elsif new.posting_level = '30' then
    if new.cons_group_id is null then
      raise exception 'Posting level 30 requires a consolidation group';
    end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.match_account_condition(a dim_account, c jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  f text := c->>'field';
  op text := lower(coalesce(c->>'operator', 'eq'));
  v jsonb := c->'value';
  sval text;
  arr text[];
  fieldval text;
begin
  fieldval := case f
    when 'code' then a.code
    when 'name' then a.name
    when 'statement_type' then a.statement_type
    when 'account_class' then a.account_class
    when 'normal_balance' then a.normal_balance
    when 'translation_method' then a.translation_method
    when 'elimination_group' then a.elimination_group
    when 'is_intercompany' then a.is_intercompany::text
    when 'is_equity_account' then a.is_equity_account::text
    when 'is_retained_earnings' then a.is_retained_earnings::text
    when 'is_net_income' then a.is_net_income::text
    else null
  end;

  if op in ('in', 'not_in') then
    if v is null or v = 'null'::jsonb then
      return op = 'not_in';
    end if;
    if jsonb_typeof(v) = 'array' then
      select array_agg(x) into arr from jsonb_array_elements_text(v) x;
    else
      arr := array[v #>> '{}'];
    end if;
    if arr is null then
      return op = 'not_in';
    end if;
    if op = 'in' then
      return fieldval = any(arr);
    else
      return fieldval is null or not (fieldval = any(arr));
    end if;
  end if;

  sval := case
    when v is null or v = 'null'::jsonb then null
    when jsonb_typeof(v) = 'string' then v #>> '{}'
    else v::text
  end;

  return case op
    when 'eq' then fieldval = sval
    when 'neq' then coalesce(fieldval, '') <> coalesce(sval, '')
    when 'starts_with' then fieldval like sval || '%'
    when 'ends_with' then fieldval like '%' || sval
    when 'contains' then fieldval ilike '%' || sval || '%'
    when 'is_true' then fieldval = 'true'
    when 'is_false' then coalesce(fieldval, 'false') <> 'true'
    else false
  end;
end $function$
;

CREATE OR REPLACE FUNCTION public.post_manual_journal(p_header jsonb, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_level char(2) := coalesce(p_header->>'posting_level', '01');
  v_version uuid := (p_header->>'version_id')::uuid;
  v_year int := (p_header->>'fiscal_year')::int;
  v_period int := (p_header->>'period')::int;
  v_group uuid := nullif(p_header->>'cons_group_id', '')::uuid;
  v_user uuid := nullif(p_header->>'created_by', '')::uuid;
  v_doc_type text := coalesce(p_header->>'doc_type', 'MANUAL');
  v_journal uuid; v_doc bigint; v_task uuid; v_rows int; v_sum numeric;
begin
  if v_tenant is null then raise exception 'No tenant context'; end if;
  if v_version is null or v_year is null or v_period is null then
    raise exception 'Version, fiscal year and period are required';
  end if;
  if v_level not in ('01','30') then
    raise exception 'Manual journals must be posted at level 01 or 30';
  end if;
  if v_level = '01' and v_group is not null then
    raise exception 'Posting level 01 must not carry a consolidation group';
  end if;
  if v_level = '30' and v_group is null then
    raise exception 'Posting level 30 requires a consolidation group';
  end if;

  perform assert_period_open(v_tenant, v_version, v_year, v_period, v_group);

  select round(sum(coalesce((l->>'amount_lc')::numeric, 0)), 2)
    into v_sum from jsonb_array_elements(p_lines) l;
  if coalesce(v_sum, 0) <> 0 then
    raise exception 'Journal is not balanced: debits minus credits = %', v_sum;
  end if;

  insert into task_run(tenant_id, task_type, cons_group_id, version_id, fiscal_year, period,
                       status, started_at, run_by)
  values (v_tenant, 'MANUAL_JOURNAL', v_group, v_version, v_year, v_period, 'RUNNING', now(), v_user)
  returning id into v_task;

  insert into journal_header(tenant_id, doc_type, posting_level, fiscal_year, period, version_id,
                            cons_group_id, task_run_id, description, created_by)
  values (v_tenant, v_doc_type, v_level, v_year, v_period, v_version, v_group, v_task,
          nullif(p_header->>'description',''), v_user)
  returning id, doc_number into v_journal, v_doc;

  insert into fact_balances(tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id,
    version_id, fiscal_year, period, posting_level,
    zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10,
    transaction_currency, local_currency, group_currency, amount_tc, amount_lc, amount_gc,
    journal_id, task_run_id, source_task)
  select v_tenant, e.id, a.id, m.id, p.id,
         case when v_level = '30' then v_group else null end,
         v_version, v_year, v_period, v_level,
         nullif(l->>'zdim01',''), nullif(l->>'zdim02',''), nullif(l->>'zdim03',''),
         nullif(l->>'zdim04',''), nullif(l->>'zdim05',''), nullif(l->>'zdim06',''),
         nullif(l->>'zdim07',''), nullif(l->>'zdim08',''), nullif(l->>'zdim09',''),
         nullif(l->>'zdim10',''),
         coalesce(nullif(l->>'transaction_currency',''), e.local_currency),
         e.local_currency,
         coalesce(g.group_currency, e.local_currency),
         coalesce((l->>'amount_tc')::numeric, (l->>'amount_lc')::numeric, 0),
         coalesce((l->>'amount_lc')::numeric, 0),
         case when coalesce(g.group_currency, e.local_currency) = e.local_currency
              then coalesce((l->>'amount_lc')::numeric, 0) else 0 end,
         v_journal, v_task, 'MANUAL'
    from jsonb_array_elements(p_lines) l
    join dim_entity e on e.tenant_id = v_tenant and e.code = l->>'entity_code'
    join dim_account a on a.tenant_id = v_tenant and a.code = l->>'account_code'
    left join dim_movement m on m.tenant_id = v_tenant and m.code = nullif(l->>'movement_code','')
    left join dim_entity p on p.tenant_id = v_tenant and p.code = nullif(l->>'partner_code','')
    left join dim_cons_group g on g.id = v_group;

  get diagnostics v_rows = row_count;
  if v_rows <> jsonb_array_length(p_lines) then
    raise exception 'Some lines reference unknown entity or account codes (% of % resolved)',
      v_rows, jsonb_array_length(p_lines);
  end if;

  update task_run set status = 'SUCCESS', rows_written = v_rows, journal_id = v_journal,
                      finished_at = now()
   where id = v_task;

  return jsonb_build_object('journal_id', v_journal, 'doc_number', v_doc,
                            'task_run_id', v_task, 'rows_posted', v_rows);
end $function$
;

CREATE OR REPLACE FUNCTION public.post_upload_batch(p_batch_id uuid, p_valid_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b record; v_journal uuid; v_doc bigint; v_task uuid; v_rows int; v_user uuid;
begin
  select * into b from upload_batch where id = p_batch_id and tenant_id = current_tenant_id();
  if not found then raise exception 'Upload batch not found'; end if;
  if b.status = 'POSTED' then raise exception 'Batch is already posted'; end if;
  perform assert_period_open(b.tenant_id, b.version_id, b.fiscal_year, b.period, null);
  if coalesce(b.error_count, 0) > 0 and not p_valid_only then
    raise exception 'Batch has % error row(s) — fix them or post valid rows only', b.error_count;
  end if;
  if coalesce(b.valid_count, 0) = 0 then raise exception 'No valid rows to post'; end if;

  select id into v_user from app_user where id = auth.uid();

  insert into task_run (tenant_id, task_type, version_id, fiscal_year, period, status, started_at, run_by)
  values (b.tenant_id, 'UPLOAD', b.version_id, b.fiscal_year, b.period, 'RUNNING', now(), v_user)
  returning id into v_task;

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period, version_id,
                             task_run_id, description, created_by)
  values (b.tenant_id, 'UPLOAD', '00', b.fiscal_year, b.period, b.version_id,
          v_task, concat('Trial balance upload ', coalesce(b.file_name, '')), v_user)
  returning id, doc_number into v_journal, v_doc;

  insert into fact_balances (
    tenant_id, entity_id, account_id, movement_id, partner_id, version_id, fiscal_year, period,
    posting_level, zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10,
    transaction_currency, local_currency, group_currency, amount_tc, amount_lc, amount_gc,
    journal_id, task_run_id, source_task)
  select b.tenant_id, e.id, a.id, m.id, p.id, b.version_id, b.fiscal_year, b.period,
         '00', s.zdim01, s.zdim02, s.zdim03, s.zdim04, s.zdim05, s.zdim06, s.zdim07, s.zdim08,
         s.zdim09, s.zdim10,
         nullif(s.transaction_currency, ''), e.local_currency, e.local_currency,
         coalesce(s.amount_tc, 0), s.amount_lc, s.amount_lc,
         v_journal, v_task, 'UPLOAD'
    from stg_upload s
    join dim_entity e on e.tenant_id = b.tenant_id and e.code = s.entity_code
    join dim_account a on a.tenant_id = b.tenant_id and a.code = s.account_code
    left join dim_movement m on m.tenant_id = b.tenant_id and m.code = s.movement_code
    left join dim_entity p on p.tenant_id = b.tenant_id and p.code = s.partner_code
   where s.batch_id = p_batch_id and s.status = 'VALID';

  get diagnostics v_rows = row_count;

  update stg_upload set status = 'POSTED' where batch_id = p_batch_id and status = 'VALID';
  update task_run set status = 'SUCCESS', rows_written = v_rows, journal_id = v_journal, finished_at = now()
   where id = v_task;
  update upload_batch set status = 'POSTED', journal_id = v_journal where id = p_batch_id;

  return jsonb_build_object('journal_id', v_journal, 'doc_number', v_doc,
                            'task_run_id', v_task, 'rows_posted', v_rows);
end $function$
;

CREATE OR REPLACE FUNCTION public.resolve_account_filter(p_tenant uuid, p_filter jsonb)
 RETURNS TABLE(account_id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_op text := upper(coalesce(p_filter->>'op', 'AND'));
  v_conds jsonb := coalesce(p_filter->'conditions', '[]'::jsonb);
begin
  if jsonb_typeof(v_conds) <> 'array' or jsonb_array_length(v_conds) = 0 then
    return query
      select a.id from dim_account a
       where a.tenant_id = p_tenant and coalesce(a.is_active, true);
    return;
  end if;

  return query
    select a.id
      from dim_account a
     where a.tenant_id = p_tenant
       and coalesce(a.is_active, true)
       and case
             when v_op = 'OR' then exists (
               select 1 from jsonb_array_elements(v_conds) c
                where match_account_condition(a, c.value))
             else not exists (
               select 1 from jsonb_array_elements(v_conds) c
                where not match_account_condition(a, c.value))
           end;
end $function$
;

CREATE OR REPLACE FUNCTION public.reverse_journal(p_journal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_src journal_header; v_journal uuid; v_doc bigint; v_task uuid; v_rows int;
begin
  select * into v_src from journal_header
   where id = p_journal_id and tenant_id = v_tenant;
  if not found then raise exception 'Journal not found'; end if;
  if v_src.is_reversed then raise exception 'Journal % is already reversed', v_src.doc_number; end if;

  perform assert_period_open(v_tenant, v_src.version_id, v_src.fiscal_year, v_src.period,
                             v_src.cons_group_id);

  insert into task_run(tenant_id, task_type, cons_group_id, version_id, fiscal_year, period,
                       status, started_at)
  values (v_tenant, 'JOURNAL_REVERSAL', v_src.cons_group_id, v_src.version_id, v_src.fiscal_year,
          v_src.period, 'RUNNING', now())
  returning id into v_task;

  insert into journal_header(tenant_id, doc_type, posting_level, fiscal_year, period, version_id,
                            cons_group_id, task_run_id, description, created_by)
  values (v_tenant, 'REVERSAL', v_src.posting_level, v_src.fiscal_year, v_src.period,
          v_src.version_id, v_src.cons_group_id, v_task,
          'Reversal of document ' || v_src.doc_number, v_src.created_by)
  returning id, doc_number into v_journal, v_doc;

  insert into fact_balances(tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id,
    version_id, fiscal_year, period, posting_level,
    zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10,
    transaction_currency, local_currency, group_currency, amount_tc, amount_lc, amount_gc,
    quantity, journal_id, task_run_id, source_task)
  select tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id,
    version_id, fiscal_year, period, posting_level,
    zdim01, zdim02, zdim03, zdim04, zdim05, zdim06, zdim07, zdim08, zdim09, zdim10,
    transaction_currency, local_currency, group_currency,
    -coalesce(amount_tc, 0), -amount_lc, -amount_gc, -coalesce(quantity, 0),
    v_journal, v_task, 'REVERSAL'
    from fact_balances where journal_id = p_journal_id and tenant_id = v_tenant;
  get diagnostics v_rows = row_count;

  update journal_header set is_reversed = true, reversed_by = v_journal where id = p_journal_id;
  update task_run set status = 'SUCCESS', rows_written = v_rows, journal_id = v_journal,
                      finished_at = now() where id = v_task;

  return jsonb_build_object('journal_id', v_journal, 'doc_number', v_doc, 'rows_posted', v_rows);
end $function$
;

CREATE OR REPLACE FUNCTION public.reverse_task_run(p_task_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_run task_run;
  v_rows int;
begin
  select * into v_run from task_run where id = p_task_run_id and tenant_id = v_tenant;
  if not found then raise exception 'Task run not found'; end if;
  if v_run.status = 'REVERSED' then raise exception 'Task run is already reversed'; end if;

  perform assert_period_open(v_tenant, v_run.version_id, v_run.fiscal_year,
                             coalesce(v_run.period, 0), v_run.cons_group_id);

  delete from fact_balances where tenant_id = v_tenant and task_run_id = p_task_run_id;
  get diagnostics v_rows = row_count;
  delete from journal_header where tenant_id = v_tenant and task_run_id = p_task_run_id;

  update task_run
     set status = 'REVERSED', rows_written = 0, journal_id = null, finished_at = now(),
         message = format('Reversed %s row(s) on %s', v_rows, to_char(now(), 'YYYY-MM-DD HH24:MI'))
   where id = p_task_run_id;

  return jsonb_build_object('rows_removed', v_rows);
end $function$
;

CREATE OR REPLACE FUNCTION public.reverse_upload_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b record; v_task uuid; v_deleted int;
begin
  select * into b from upload_batch where id = p_batch_id and tenant_id = current_tenant_id();
  if not found then raise exception 'Upload batch not found'; end if;
  if b.status <> 'POSTED' then raise exception 'Only a posted batch can be reversed'; end if;
  perform assert_period_open(b.tenant_id, b.version_id, b.fiscal_year, b.period, null);

  select jh.task_run_id into v_task from journal_header jh where jh.id = b.journal_id;
  delete from fact_balances where tenant_id = b.tenant_id and task_run_id = v_task;
  get diagnostics v_deleted = row_count;

  update journal_header set is_reversed = true where id = b.journal_id;
  update task_run set status = 'REVERSED', finished_at = now() where id = v_task;
  update stg_upload set status = 'VALID' where batch_id = p_batch_id and status = 'POSTED';
  update upload_batch set status = 'REVERSED' where id = p_batch_id;

  return jsonb_build_object('rows_deleted', v_deleted, 'task_run_id', v_task);
end $function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.run_bcf(p_version uuid, p_year integer, p_entities uuid[] DEFAULT '{}'::uuid[], p_groups uuid[] DEFAULT '{}'::uuid[])
 RETURNS TABLE(task_run_id uuid, target_kind text, target_id uuid, target_code text, target_name text, rows_written integer, status text, message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := current_tenant_id();
  v_target record;
  v_task uuid;
  v_rows int;
  v_status text;
  v_message text;
begin
  if v_tenant is null then raise exception 'No tenant for current user'; end if;
  if p_version is null or p_year is null then raise exception 'Version and fiscal year are required'; end if;

  for v_target in
    select 'ENTITY'::text as kind, e.id, e.code, e.name
      from dim_entity e
     where e.tenant_id = v_tenant and e.id = any(coalesce(p_entities, '{}'::uuid[]))
    union all
    select 'GROUP'::text, g.id, g.code, g.name
      from dim_cons_group g
     where g.tenant_id = v_tenant and g.id = any(coalesce(p_groups, '{}'::uuid[]))
    order by 1, 3
  loop
    insert into task_run(tenant_id, task_type, entity_id, cons_group_id, version_id,
                         fiscal_year, period, status, started_at, run_by)
    values (v_tenant, 'BCF',
            case when v_target.kind = 'ENTITY' then v_target.id end,
            case when v_target.kind = 'GROUP' then v_target.id end,
            p_version, p_year, 0, 'RUNNING', now(), auth.uid())
    returning id into v_task;

    begin
      if v_target.kind = 'ENTITY' then
        v_rows := run_bcf_entity(v_task, v_tenant, p_version, v_target.id, p_year);
      else
        v_rows := run_bcf_group(v_task, v_tenant, p_version, v_target.id, p_year);
      end if;
      v_status := case when v_rows = 0 then 'WARNING' else 'SUCCESS' end;
      v_message := case when v_rows = 0 then 'No source balances matched the active BCF rules' end;
    exception when others then
      v_rows := 0;
      v_status := 'ERROR';
      v_message := sqlerrm;
    end;

    update task_run
       set status = v_status, rows_written = v_rows, message = v_message, finished_at = now(),
           journal_id = (select id from journal_header where task_run_id = v_task limit 1)
     where id = v_task;

    return query select v_task, v_target.kind, v_target.id, v_target.code, v_target.name,
                        v_rows, v_status, v_message;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.run_bcf_entity(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_entity uuid, p_year integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_movement uuid;
  v_re_account uuid;
  v_entity_ccy char(3);
  v_rows int := 0;
  v_step_rows int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, 0, null);

  select local_currency into v_entity_ccy
    from dim_entity where id = p_entity and tenant_id = p_tenant;
  if v_entity_ccy is null then
    raise exception 'Entity not found or has no local currency';
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and entity_id = p_entity
     and cons_group_id is null and fiscal_year = p_year and period = 0
     and source_task = 'BCF' and posting_level = '01';

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, entity_id, task_run_id, description)
  values (p_tenant, 'BCF', '01', p_year, 0, p_version, p_entity, p_task_run_id,
          format('Entity balance carry forward %s -> %s', p_year - 1, p_year))
  returning id into v_journal_id;

  for v_rule in
    select * from rule_bcf where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    select id into v_target_movement from dim_movement
     where tenant_id = p_tenant and code = v_rule.target_movement_code;
    if v_target_movement is null then
      raise exception 'Rule %: target movement code % does not exist', v_rule.code, v_rule.target_movement_code;
    end if;

    with src as (
      select f.account_id,
             case when v_rule.carry_partner then f.partner_id else null end as partner_id,
             case when v_rule.carry_custom_dims then f.zdim01 else null end as zdim01,
             case when v_rule.carry_custom_dims then f.zdim02 else null end as zdim02,
             case when v_rule.carry_custom_dims then f.zdim03 else null end as zdim03,
             case when v_rule.carry_custom_dims then f.zdim04 else null end as zdim04,
             case when v_rule.carry_custom_dims then f.zdim05 else null end as zdim05,
             max(f.local_currency) as local_currency,
             max(f.group_currency) as group_currency,
             sum(f.amount_lc) as amount_lc,
             sum(f.amount_gc) as amount_gc
        from fact_balances f
        join dim_account a on a.id = f.account_id
        left join dim_movement m on m.id = f.movement_id
       where f.tenant_id = p_tenant and f.version_id = p_version and f.entity_id = p_entity
         and f.cons_group_id is null and f.fiscal_year = p_year - 1 and f.posting_level = '01'
         and a.statement_type in ('BS','OCI')
         and (v_rule.source_movement_class is null
              or array_length(v_rule.source_movement_class, 1) is null
              or m.movement_class = any(v_rule.source_movement_class))
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.source_account_filter) r)
       group by 1,2,3,4,5,6,7
      having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
    )
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, version_id,
      fiscal_year, period, posting_level, zdim01, zdim02, zdim03, zdim04, zdim05,
      local_currency, group_currency, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, p_entity, src.account_id, v_target_movement, src.partner_id, p_version,
           p_year, 0, '01', src.zdim01, src.zdim02, src.zdim03, src.zdim04, src.zdim05,
           coalesce(src.local_currency, v_entity_ccy), coalesce(src.group_currency, v_entity_ccy),
           src.amount_lc, src.amount_gc, v_journal_id, p_task_run_id, 'BCF'
      from src;
    get diagnostics v_step_rows = row_count;
    v_rows := v_rows + v_step_rows;

    if v_rule.pl_to_retained_earnings then
      select id into v_re_account from dim_account
       where tenant_id = p_tenant and code = v_rule.retained_earnings_account_code;
      if v_re_account is null then
        raise exception 'Rule %: retained earnings account % does not exist', v_rule.code,
          coalesce(v_rule.retained_earnings_account_code, '(not set)');
      end if;

      with src as (
        select max(f.local_currency) as local_currency, max(f.group_currency) as group_currency,
               sum(f.amount_lc) as amount_lc, sum(f.amount_gc) as amount_gc
          from fact_balances f
          join dim_account a on a.id = f.account_id
         where f.tenant_id = p_tenant and f.version_id = p_version and f.entity_id = p_entity
           and f.cons_group_id is null and f.fiscal_year = p_year - 1
           and f.posting_level = '01' and a.statement_type = 'PL'
        having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
      )
      insert into fact_balances (
        tenant_id, entity_id, account_id, movement_id, version_id, fiscal_year, period,
        posting_level, local_currency, group_currency, amount_lc, amount_gc,
        journal_id, task_run_id, source_task)
      select p_tenant, p_entity, v_re_account, v_target_movement, p_version, p_year, 0, '01',
             coalesce(src.local_currency, v_entity_ccy), coalesce(src.group_currency, v_entity_ccy),
             src.amount_lc, src.amount_gc, v_journal_id, p_task_run_id, 'BCF'
        from src;
      get diagnostics v_step_rows = row_count;
      v_rows := v_rows + v_step_rows;
    end if;
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;
  return v_rows;
end $function$
;

CREATE OR REPLACE FUNCTION public.run_bcf_group(p_task_run_id uuid, p_tenant uuid, p_version uuid, p_cons_group uuid, p_year integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rule record;
  v_journal_id uuid;
  v_target_movement uuid;
  v_re_account uuid;
  v_group_ccy char(3);
  v_rows int := 0;
  v_step_rows int;
begin
  perform assert_period_open(p_tenant, p_version, p_year, 0, p_cons_group);

  select group_currency into v_group_ccy
    from dim_cons_group where id = p_cons_group and tenant_id = p_tenant;
  if v_group_ccy is null then
    raise exception 'Consolidation group not found';
  end if;

  delete from fact_balances
   where tenant_id = p_tenant and version_id = p_version and cons_group_id = p_cons_group
     and fiscal_year = p_year and period = 0 and source_task = 'BCF'
     and posting_level in ('10','20','30');

  insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year, period,
                              version_id, cons_group_id, task_run_id, description)
  values (p_tenant, 'BCF', '30', p_year, 0, p_version, p_cons_group, p_task_run_id,
          format('Group balance carry forward %s -> %s', p_year - 1, p_year))
  returning id into v_journal_id;

  for v_rule in
    select * from rule_bcf where tenant_id = p_tenant and coalesce(is_active, true)
     order by sequence nulls last, code
  loop
    select id into v_target_movement from dim_movement
     where tenant_id = p_tenant and code = v_rule.target_movement_code;
    if v_target_movement is null then
      raise exception 'Rule %: target movement code % does not exist', v_rule.code, v_rule.target_movement_code;
    end if;

    with src as (
      select f.entity_id, f.account_id, f.posting_level,
             case when v_rule.carry_partner then f.partner_id else null end as partner_id,
             case when v_rule.carry_custom_dims then f.zdim01 else null end as zdim01,
             case when v_rule.carry_custom_dims then f.zdim02 else null end as zdim02,
             case when v_rule.carry_custom_dims then f.zdim03 else null end as zdim03,
             case when v_rule.carry_custom_dims then f.zdim04 else null end as zdim04,
             case when v_rule.carry_custom_dims then f.zdim05 else null end as zdim05,
             max(f.local_currency) as local_currency,
             sum(f.amount_lc) as amount_lc,
             sum(f.amount_gc) as amount_gc
        from fact_balances f
        join dim_account a on a.id = f.account_id
        left join dim_movement m on m.id = f.movement_id
       where f.tenant_id = p_tenant and f.version_id = p_version
         and f.cons_group_id = p_cons_group and f.fiscal_year = p_year - 1
         and f.posting_level in ('10','20','30')
         and a.statement_type in ('BS','OCI')
         and (v_rule.source_movement_class is null
              or array_length(v_rule.source_movement_class, 1) is null
              or m.movement_class = any(v_rule.source_movement_class))
         and f.account_id in (select r.account_id
                                from resolve_account_filter(p_tenant, v_rule.source_account_filter) r)
       group by 1,2,3,4,5,6,7,8,9
      having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
    )
    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
      fiscal_year, period, posting_level, zdim01, zdim02, zdim03, zdim04, zdim05,
      local_currency, group_currency, amount_lc, amount_gc, journal_id, task_run_id, source_task)
    select p_tenant, src.entity_id, src.account_id, v_target_movement, src.partner_id,
           p_cons_group, p_version, p_year, 0, src.posting_level,
           src.zdim01, src.zdim02, src.zdim03, src.zdim04, src.zdim05,
           src.local_currency, v_group_ccy, src.amount_lc, src.amount_gc,
           v_journal_id, p_task_run_id, 'BCF'
      from src;
    get diagnostics v_step_rows = row_count;
    v_rows := v_rows + v_step_rows;

    if v_rule.pl_to_retained_earnings then
      select id into v_re_account from dim_account
       where tenant_id = p_tenant and code = v_rule.retained_earnings_account_code;
      if v_re_account is null then
        raise exception 'Rule %: retained earnings account % does not exist', v_rule.code,
          coalesce(v_rule.retained_earnings_account_code, '(not set)');
      end if;

      with src as (
        select f.entity_id, f.posting_level, max(f.local_currency) as local_currency,
               sum(f.amount_lc) as amount_lc, sum(f.amount_gc) as amount_gc
          from fact_balances f
          join dim_account a on a.id = f.account_id
         where f.tenant_id = p_tenant and f.version_id = p_version
           and f.cons_group_id = p_cons_group and f.fiscal_year = p_year - 1
           and f.posting_level in ('10','20','30') and a.statement_type = 'PL'
         group by 1,2
        having sum(f.amount_gc) <> 0 or sum(f.amount_lc) <> 0
      )
      insert into fact_balances (
        tenant_id, entity_id, account_id, movement_id, partner_id, cons_group_id, version_id,
        fiscal_year, period, posting_level, local_currency, group_currency, amount_lc, amount_gc,
        journal_id, task_run_id, source_task)
      select p_tenant, src.entity_id, v_re_account, v_target_movement, null,
             p_cons_group, p_version, p_year, 0, src.posting_level,
             src.local_currency, v_group_ccy, src.amount_lc, src.amount_gc,
             v_journal_id, p_task_run_id, 'BCF'
        from src;
      get diagnostics v_step_rows = row_count;
      v_rows := v_rows + v_step_rows;
    end if;
  end loop;

  if v_rows = 0 then
    delete from journal_header where id = v_journal_id;
  end if;
  return v_rows;
end $function$
;

CREATE OR REPLACE FUNCTION public.validate_upload_batch(p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b record;
  v_total int; v_valid int; v_errors int;
  v_result jsonb;
begin
  select * into b from upload_batch where id = p_batch_id and tenant_id = current_tenant_id();
  if not found then raise exception 'Upload batch not found'; end if;
  perform assert_period_open(b.tenant_id, b.version_id, b.fiscal_year, b.period, null);

  update stg_upload set status = 'PENDING', error_msg = null where batch_id = p_batch_id;

  with dupes as (
    select s.id,
           count(*) over (partition by s.entity_code, s.account_code, coalesce(s.movement_code,''),
                                       coalesce(s.partner_code,''), coalesce(s.transaction_currency,''),
                                       coalesce(s.zdim01,''), coalesce(s.zdim02,''), coalesce(s.zdim03,''),
                                       coalesce(s.zdim04,''), coalesce(s.zdim05,''), coalesce(s.zdim06,''),
                                       coalesce(s.zdim07,''), coalesce(s.zdim08,''), coalesce(s.zdim09,''),
                                       coalesce(s.zdim10,'')) as n
      from stg_upload s where s.batch_id = p_batch_id
  ),
  checked as (
    select s.id,
      array_remove(array[
        case when e.id is null then 'ENTITY_NOT_FOUND' end,
        case when a.id is null then 'ACCOUNT_NOT_FOUND' end,
        case when coalesce(s.movement_code,'') <> '' and m.id is null then 'MOVEMENT_NOT_FOUND' end,
        case when coalesce(s.partner_code,'') <> '' and p.id is null then 'PARTNER_NOT_FOUND' end,
        case when a.requires_partner and coalesce(s.partner_code,'') = '' then 'PARTNER_REQUIRED' end,
        case when a.requires_movement and coalesce(s.movement_code,'') = '' then 'MOVEMENT_REQUIRED' end,
        case when s.amount_lc is null then 'AMOUNT_LC_NOT_NUMERIC' end,
        case when coalesce(s.transaction_currency,'') <> ''
               and not exists (select 1 from dim_currency c where c.code = s.transaction_currency)
             then 'CURRENCY_UNKNOWN' end,
        case when coalesce(s.transaction_currency,'') <> '' and s.amount_tc is null
             then 'AMOUNT_TC_NOT_NUMERIC' end,
        case when coalesce(s.transaction_currency,'') <> '' and e.local_currency is not null
               and s.transaction_currency = e.local_currency and s.amount_tc is not null
               and s.amount_tc <> s.amount_lc
             then 'CURRENCY_INCONSISTENT' end,
        case when exists (
               select 1 from dim_registry r
                where r.tenant_id = b.tenant_id and r.is_active and r.physical_column like 'zdim%'
                  and coalesce(to_jsonb(s) ->> r.physical_column, '') <> ''
                  and not exists (
                        select 1 from dim_generic_member g
                         where g.tenant_id = b.tenant_id and g.dim_code = r.dim_code
                           and g.code = to_jsonb(s) ->> r.physical_column)
             ) then 'DIM_MEMBER_NOT_FOUND' end,
        case when d.n > 1 then 'DUPLICATE_KEY' end
      ], null) as errs
    from stg_upload s
    join dupes d on d.id = s.id
    left join dim_entity e on e.tenant_id = b.tenant_id and e.code = s.entity_code
    left join dim_account a on a.tenant_id = b.tenant_id and a.code = s.account_code
    left join dim_movement m on m.tenant_id = b.tenant_id and m.code = s.movement_code
    left join dim_entity p on p.tenant_id = b.tenant_id and p.code = s.partner_code
    where s.batch_id = p_batch_id
  )
  update stg_upload s
     set status = case when cardinality(c.errs) = 0 then 'VALID' else 'ERROR' end,
         error_msg = case when cardinality(c.errs) = 0 then null else array_to_string(c.errs, ',') end
    from checked c where c.id = s.id;

  select count(*), count(*) filter (where status = 'VALID'), count(*) filter (where status = 'ERROR')
    into v_total, v_valid, v_errors
    from stg_upload where batch_id = p_batch_id;

  update upload_batch
     set row_count = v_total, valid_count = v_valid, error_count = v_errors,
         status = case when status = 'POSTED' then status else 'VALIDATED' end
   where id = p_batch_id;

  select jsonb_build_object(
    'total_rows', v_total,
    'valid_rows', v_valid,
    'error_rows', v_errors,
    'errors_by_type', coalesce((
        select jsonb_agg(jsonb_build_object('error_code', t.code, 'row_count', t.n, 'rows', t.rows) order by t.n desc)
          from (select err as code, count(*) as n, (array_agg(row_no order by row_no))[1:200] as rows
                  from (select s.row_no, unnest(string_to_array(s.error_msg, ',')) as err
                          from stg_upload s where s.batch_id = p_batch_id and s.status = 'ERROR') x
                 group by err) t), '[]'::jsonb),
    'trial_balance', coalesce((
        select jsonb_agg(jsonb_build_object('entity_code', tb.entity_code, 'sum_lc', tb.total,
                                            'balanced', tb.total = 0) order by tb.entity_code)
          from (select entity_code, round(coalesce(sum(amount_lc), 0), 2) as total
                  from stg_upload where batch_id = p_batch_id group by entity_code) tb), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $function$
;

-- ======================================================================
-- TRIGGERS
-- ======================================================================

CREATE TRIGGER fact_balances_posting_level BEFORE INSERT OR UPDATE ON public.fact_balances FOR EACH ROW EXECUTE FUNCTION enforce_posting_level();
CREATE TRIGGER journal_header_posting_level BEFORE INSERT OR UPDATE ON public.journal_header FOR EACH ROW EXECUTE FUNCTION enforce_journal_posting_level();

-- ======================================================================
-- VIEWS
-- ======================================================================

create or replace view public.v_fact_browser with (security_invoker=true) as  SELECT f.id,
    f.tenant_id,
    f.journal_id,
    f.task_run_id,
    f.source_task,
    f.created_at,
    f.posting_level,
    f.fiscal_year,
    f.period,
    f.version_id,
    v.code AS version_code,
    e.code AS entity_code,
    e.name AS entity_name,
    a.code AS account_code,
    a.name AS account_name,
    m.code AS movement_code,
    m.name AS movement_name,
    p.code AS partner_code,
    p.name AS partner_name,
    f.cons_group_id,
    cg.code AS cons_group_code,
    f.zdim01,
    f.zdim02,
    f.zdim03,
    f.zdim04,
    f.zdim05,
    f.zdim06,
    f.zdim07,
    f.zdim08,
    f.zdim09,
    f.zdim10,
    f.transaction_currency,
    f.local_currency,
    f.group_currency,
    f.amount_tc,
    f.amount_lc,
    f.amount_gc,
    f.quantity
   FROM ((((((fact_balances f
     JOIN dim_entity e ON ((e.id = f.entity_id)))
     JOIN dim_account a ON ((a.id = f.account_id)))
     JOIN dim_version v ON ((v.id = f.version_id)))
     LEFT JOIN dim_movement m ON ((m.id = f.movement_id)))
     LEFT JOIN dim_entity p ON ((p.id = f.partner_id)))
     LEFT JOIN dim_cons_group cg ON ((cg.id = f.cons_group_id)));

create or replace view public.v_hierarchy_flat with (security_invoker=true) as  WITH RECURSIVE edges AS (
         SELECT dim_hierarchy_node.tenant_id,
            dim_hierarchy_node.hierarchy_id,
            dim_hierarchy_node.member_code,
            dim_hierarchy_node.parent_member_code,
            COALESCE((dim_hierarchy_node.aggregation_sign)::integer, 1) AS sign
           FROM dim_hierarchy_node
        ), closure AS (
         SELECT e.tenant_id,
            e.hierarchy_id,
            e.member_code AS ancestor_code,
            e.member_code AS descendant_code,
            0 AS depth,
            1 AS sign
           FROM edges e
        UNION ALL
         SELECT c.tenant_id,
            c.hierarchy_id,
            c.ancestor_code,
            e.member_code,
            (c.depth + 1),
            (c.sign * e.sign) AS int4
           FROM (closure c
             JOIN edges e ON (((e.tenant_id = c.tenant_id) AND (e.hierarchy_id = c.hierarchy_id) AND (e.parent_member_code = c.descendant_code))))
          WHERE (c.depth < 30)
        )
 SELECT hierarchy_id,
    ancestor_code,
    descendant_code,
    depth,
    sign
   FROM closure;

-- ======================================================================
-- ROW LEVEL SECURITY
-- ======================================================================

alter table public.app_user enable row level security;
alter table public.cons_group_member enable row level security;
alter table public.dim_account enable row level security;
alter table public.dim_cons_group enable row level security;
alter table public.dim_currency enable row level security;
alter table public.dim_entity enable row level security;
alter table public.dim_generic_member enable row level security;
alter table public.dim_hierarchy enable row level security;
alter table public.dim_hierarchy_node enable row level security;
alter table public.dim_movement enable row level security;
alter table public.dim_registry enable row level security;
alter table public.dim_version enable row level security;
alter table public.fact_balances enable row level security;
alter table public.fx_rate enable row level security;
alter table public.historical_rate enable row level security;
alter table public.ic_reconciliation enable row level security;
alter table public.investment_register enable row level security;
alter table public.journal_header enable row level security;
alter table public.period_status enable row level security;
alter table public.rule_bcf enable row level security;
alter table public.rule_coi enable row level security;
alter table public.rule_ic_elim enable row level security;
alter table public.rule_net_income enable row level security;
alter table public.rule_translation enable row level security;
alter table public.stg_upload enable row level security;
alter table public.task_run enable row level security;
alter table public.tenant enable row level security;
alter table public.upload_batch enable row level security;
alter table public.upload_mapping enable row level security;
alter table public.workflow_run enable row level security;
alter table public.workflow_step enable row level security;
alter table public.workflow_template enable row level security;

-- ======================================================================
-- POLICIES
-- ======================================================================

create policy own_user on public.app_user for all using ((id = auth.uid()));
create policy tenant_isolation on public.cons_group_member for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_account for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_cons_group for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy currency_read on public.dim_currency for select using (true);
create policy tenant_isolation on public.dim_entity for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_generic_member for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_hierarchy for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_hierarchy_node for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_movement for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_registry for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.dim_version for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.fact_balances for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.fx_rate for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.historical_rate for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.ic_reconciliation for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.investment_register for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.journal_header for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.period_status for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.rule_bcf for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.rule_coi for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.rule_ic_elim for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.rule_net_income for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.rule_translation for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.stg_upload for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.task_run for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_own_read on public.tenant for select using ((EXISTS ( SELECT 1
   FROM app_user u
  WHERE ((u.id = auth.uid()) AND (u.tenant_id = tenant.id)))));
create policy tenant_signup_insert on public.tenant for insert with check (true);
create policy tenant_isolation on public.upload_batch for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.upload_mapping for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.workflow_run for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.workflow_step for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
create policy tenant_isolation on public.workflow_template for all using ((tenant_id = current_tenant_id())) with check ((tenant_id = current_tenant_id()));
