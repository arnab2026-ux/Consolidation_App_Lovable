-- Phase 3: let the demo seed reset a tenant that has close runs on it.
--
-- seed_demo_dataset was written before workflow runs existed, so its reset
-- deleted dim_cons_group while workflow_run still referenced it. Re-seeding
-- after running a close failed on the foreign key.

CREATE OR REPLACE FUNCTION public.seed_demo_dataset(p_tenant uuid DEFAULT NULL::uuid, p_reset boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid := coalesce(p_tenant, current_tenant_id());
  v_version uuid;
  v_group   uuid;
  v_journal uuid;
  v_task    uuid;
  v_hier    uuid;
  v_rows    int;
  v_year    int;
begin
  if v_tenant is null then
    raise exception 'No tenant: pass p_tenant or call as an authenticated user';
  end if;

  -- ------------------------------------------------------------------ reset
  if p_reset then
    delete from fact_balances      where tenant_id = v_tenant;
    delete from ic_reconciliation  where tenant_id = v_tenant;
    -- workflow_run holds a foreign key to dim_cons_group, and task_run holds
    -- one to workflow_step, so the close scaffolding has to go before the
    -- master data it points at.
    delete from workflow_run       where tenant_id = v_tenant;
    delete from task_run           where tenant_id = v_tenant;
    delete from workflow_step      where tenant_id = v_tenant;
    delete from workflow_template  where tenant_id = v_tenant;
    delete from journal_header     where tenant_id = v_tenant;
    delete from upload_batch       where tenant_id = v_tenant;
    delete from stg_upload         where tenant_id = v_tenant;
    delete from investment_register where tenant_id = v_tenant;
    delete from historical_rate    where tenant_id = v_tenant;
    delete from cons_group_member  where tenant_id = v_tenant;
    delete from period_status      where tenant_id = v_tenant;
    delete from fx_rate            where tenant_id = v_tenant;
    delete from dim_hierarchy_node where tenant_id = v_tenant;
    delete from dim_hierarchy      where tenant_id = v_tenant;
    delete from rule_bcf           where tenant_id = v_tenant;
    delete from rule_net_income    where tenant_id = v_tenant;
    delete from rule_translation   where tenant_id = v_tenant;
    delete from rule_ic_elim       where tenant_id = v_tenant;
    delete from rule_coi           where tenant_id = v_tenant;
    delete from dim_cons_group     where tenant_id = v_tenant;
    delete from dim_account        where tenant_id = v_tenant;
    delete from dim_movement       where tenant_id = v_tenant;
    delete from dim_entity         where tenant_id = v_tenant;
    delete from dim_generic_member where tenant_id = v_tenant;
    delete from dim_registry       where tenant_id = v_tenant;
    delete from dim_version        where tenant_id = v_tenant;
  end if;

  -- ------------------------------------------------------------- currencies
  insert into dim_currency (code, name, decimals) values
    ('USD','US Dollar',2), ('EUR','Euro',2), ('GBP','Pound Sterling',2),
    ('SAR','Saudi Riyal',2), ('INR','Indian Rupee',2)
  on conflict (code) do nothing;

  -- ---------------------------------------------------------------- version
  insert into dim_version (tenant_id, code, name, version_type)
  values (v_tenant, 'ACT01', 'Actuals', 'ACTUAL')
  on conflict (tenant_id, code) do update set name = excluded.name
  returning id into v_version;

  -- --------------------------------------------------------------- entities
  insert into dim_entity (tenant_id, code, name, local_currency, country,
                          entity_type, default_cons_method, acquisition_date)
  values
    (v_tenant,'PARENT'  ,'Global Holdings Inc'  ,'USD','US','PARENT'    ,'PURCHASE'     ,'2015-01-01'),
    (v_tenant,'SUB_US'  ,'Americas Corp'        ,'USD','US','SUBSIDIARY','PURCHASE'     ,'2018-01-01'),
    (v_tenant,'SUB_EU'  ,'Europe GmbH'          ,'EUR','DE','SUBSIDIARY','PURCHASE'     ,'2020-07-01'),
    (v_tenant,'JV_SA'   ,'Arabia Ventures LLC'  ,'SAR','SA','JV'        ,'PROPORTIONATE','2021-01-01'),
    (v_tenant,'ASSOC_IN','Bharat Associates Pvt','INR','IN','ASSOCIATE' ,'EQUITY'       ,'2022-04-01')
  on conflict (tenant_id, code) do update set name = excluded.name;

  -- --------------------------------------------------------- movement types
  insert into dim_movement (tenant_id, code, name, movement_class,
                            is_bcf_source, is_bcf_target, display_order)
  values
    (v_tenant,'100','Opening balance','OPENING'     ,false,true ,10),
    (v_tenant,'120','Additions'      ,'ADDITION'    ,true ,false,20),
    (v_tenant,'130','Disposals'      ,'DISPOSAL'    ,true ,false,30),
    (v_tenant,'140','Transfers'      ,'TRANSFER'    ,true ,false,40),
    (v_tenant,'150','FX effect'      ,'FX_EFFECT'   ,true ,false,50),
    (v_tenant,'160','Scope change'   ,'SCOPE_CHANGE',true ,false,60),
    (v_tenant,'199','Closing balance','CLOSING'     ,true ,false,99)
  on conflict (tenant_id, code) do update set name = excluded.name;

  -- ---------------------------------------------------------------- accounts
  insert into dim_account (tenant_id, code, name, statement_type, account_class,
      normal_balance, requires_partner, requires_movement, is_intercompany,
      elimination_group, translation_method, is_investment_account,
      is_equity_account, is_retained_earnings, is_net_income)
  select v_tenant, x.code, x.name, x.st, x.cls, x.nb, x.rp, x.rm, x.ic,
         x.eg, x.tm, x.inv, x.eq, x.re, x.ni
  from (values
    -- assets
    ('1000','Cash and cash equivalents'       ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1010','Short-term deposits'             ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1100','Trade receivables'               ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1110','Intercompany receivables'        ,'BS','ASSET'    ,'D',true ,false,true ,'IC_TRADE_BS','CLOSING'   ,false,false,false,false),
    ('1120','Other receivables'               ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1130','Intercompany loans receivable'   ,'BS','ASSET'    ,'D',true ,false,true ,'IC_LOAN'  ,'CLOSING'   ,false,false,false,false),
    ('1150','Allowance for doubtful debts'    ,'BS','ASSET'    ,'C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1200','Inventories - raw materials'     ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1210','Inventories - finished goods'    ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1300','Prepayments'                     ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('1400','Property, plant and equipment'   ,'BS','ASSET'    ,'D',false,true ,false,null       ,'HISTORICAL',false,false,false,false),
    ('1410','Accumulated depreciation'        ,'BS','ASSET'    ,'C',false,true ,false,null       ,'HISTORICAL',false,false,false,false),
    ('1450','Right-of-use assets'             ,'BS','ASSET'    ,'D',false,true ,false,null       ,'HISTORICAL',false,false,false,false),
    ('1500','Intangible assets'               ,'BS','ASSET'    ,'D',false,true ,false,null       ,'HISTORICAL',false,false,false,false),
    ('1510','Accumulated amortisation'        ,'BS','ASSET'    ,'C',false,true ,false,null       ,'HISTORICAL',false,false,false,false),
    ('1600','Goodwill'                        ,'BS','ASSET'    ,'D',true ,true ,false,null       ,'HISTORICAL',false,false,false,false),
    ('1700','Investments in subsidiaries'     ,'BS','ASSET'    ,'D',true ,true ,false,'IC_INVEST','HISTORICAL',true ,false,false,false),
    ('1710','Investments in associates/JV'    ,'BS','ASSET'    ,'D',true ,true ,false,'IC_INVEST','HISTORICAL',true ,false,false,false),
    ('1720','Equity-method carrying amount'   ,'BS','ASSET'    ,'D',true ,true ,false,null       ,'HISTORICAL',true ,false,false,false),
    ('1800','Deferred tax assets'             ,'BS','ASSET'    ,'D',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    -- liabilities
    ('2000','Trade payables'                  ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2010','Intercompany payables'           ,'BS','LIABILITY','C',true ,false,true ,'IC_TRADE_BS','CLOSING'   ,false,false,false,false),
    ('2020','Other payables'                  ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2100','Accruals'                        ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2200','Short-term borrowings'           ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2210','Long-term borrowings'            ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2220','Intercompany loans payable'      ,'BS','LIABILITY','C',true ,false,true ,'IC_LOAN'  ,'CLOSING'   ,false,false,false,false),
    ('2300','Provisions'                      ,'BS','LIABILITY','C',false,true ,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2400','Deferred tax liabilities'        ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2500','Current tax payable'             ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    ('2600','Lease liabilities'               ,'BS','LIABILITY','C',false,false,false,null       ,'CLOSING'   ,false,false,false,false),
    -- equity
    ('3000','Share capital'                   ,'BS','EQUITY'   ,'C',false,true ,false,null       ,'HISTORICAL',false,true ,false,false),
    ('3010','Share premium'                   ,'BS','EQUITY'   ,'C',false,true ,false,null       ,'HISTORICAL',false,true ,false,false),
    ('3100','Retained earnings'               ,'BS','EQUITY'   ,'C',false,true ,false,null       ,'HISTORICAL',false,true ,true ,false),
    ('3200','Net income for the period'       ,'BS','EQUITY'   ,'C',false,true ,false,null       ,'AVERAGE'   ,false,true ,false,true ),
    ('3300','Other reserves'                  ,'BS','EQUITY'   ,'C',false,true ,false,null       ,'HISTORICAL',false,true ,false,false),
    ('3400','Cumulative translation adjustment','BS','EQUITY'  ,'C',false,true ,false,null       ,'NONE'      ,false,true ,false,false),
    ('3500','Non-controlling interests'       ,'BS','EQUITY'   ,'C',true ,true ,false,null       ,'CLOSING'   ,false,true ,false,false),
    -- income
    ('4000','Revenue'                         ,'PL','INCOME'   ,'C',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('4010','Intercompany revenue'            ,'PL','INCOME'   ,'C',true ,false,true ,'IC_TRADE_PL','AVERAGE'   ,false,false,false,false),
    ('4100','Other operating income'          ,'PL','INCOME'   ,'C',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('4200','Dividend income'                 ,'PL','INCOME'   ,'C',true ,false,true ,'IC_DIV'   ,'AVERAGE'   ,false,false,false,false),
    ('4300','Interest income'                 ,'PL','INCOME'   ,'C',true ,false,true ,'IC_INT'   ,'AVERAGE'   ,false,false,false,false),
    ('4400','Gain on disposal'                ,'PL','INCOME'   ,'C',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('4500','Share of profit of associates'   ,'PL','INCOME'   ,'C',true ,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('4600','Foreign exchange gains'          ,'PL','INCOME'   ,'C',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('4700','Bargain purchase gain'           ,'PL','INCOME'   ,'C',true ,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    -- expenses
    ('5000','Cost of goods sold'              ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5010','Intercompany purchases'          ,'PL','EXPENSE'  ,'D',true ,false,true ,'IC_TRADE_PL','AVERAGE'   ,false,false,false,false),
    ('5100','Salaries and wages'              ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5110','Employee benefits'               ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5200','Rent and occupancy'              ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5210','Utilities'                       ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5300','Professional fees'               ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5310','Intercompany management fees'    ,'PL','EXPENSE'  ,'D',true ,false,true ,'IC_SERV'  ,'AVERAGE'   ,false,false,false,false),
    ('5400','Marketing'                       ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5500','Depreciation'                    ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5510','Amortisation'                    ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5600','Interest expense'                ,'PL','EXPENSE'  ,'D',true ,false,true ,'IC_INT'   ,'AVERAGE'   ,false,false,false,false),
    ('5700','Foreign exchange losses'         ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5800','Impairment of goodwill'          ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5900','Income tax expense'              ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5950','Other expenses'                  ,'PL','EXPENSE'  ,'D',false,false,false,null       ,'AVERAGE'   ,false,false,false,false),
    ('5980','NCI share of profit'             ,'PL','EXPENSE'  ,'D',true ,false,false,null       ,'AVERAGE'   ,false,false,false,false)
  ) as x(code,name,st,cls,nb,rp,rm,ic,eg,tm,inv,eq,re,ni)
  on conflict (tenant_id, code) do update
    set name = excluded.name,
        requires_partner = excluded.requires_partner,
        requires_movement = excluded.requires_movement,
        elimination_group = excluded.elimination_group,
        translation_method = excluded.translation_method;

  -- ------------------------------------------------------------- data model
  insert into dim_registry (tenant_id, dim_code, dim_name, is_mandatory, is_active,
                            physical_column, master_table, display_order)
  values
    (v_tenant,'ENTITY'       ,'Entity / Consolidation Unit',true ,true ,'entity_id'    ,'dim_entity'        ,10),
    (v_tenant,'ACCOUNT'      ,'Account / FS Item'          ,true ,true ,'account_id'   ,'dim_account'       ,20),
    (v_tenant,'MOVEMENT'     ,'Movement Type'              ,true ,true ,'movement_id'  ,'dim_movement'      ,30),
    (v_tenant,'PARTNER'      ,'Partner Entity'             ,true ,true ,'partner_id'   ,'dim_entity'        ,40),
    (v_tenant,'CONS_GROUP'   ,'Consolidation Group'        ,true ,true ,'cons_group_id','dim_cons_group'    ,50),
    (v_tenant,'VERSION'      ,'Version'                    ,true ,true ,'version_id'   ,'dim_version'       ,60),
    (v_tenant,'POSTING_LEVEL','Posting Level'              ,true ,true ,'posting_level',null                ,70),
    (v_tenant,'PROFIT_CENTER','Profit Center'              ,false,true ,'zdim01'       ,'dim_generic_member',101),
    (v_tenant,'SEGMENT'      ,'Segment'                    ,false,true ,'zdim02'       ,'dim_generic_member',102)
  on conflict (tenant_id, dim_code) do update
    set is_active = true, dim_name = excluded.dim_name;

  insert into dim_generic_member (tenant_id, dim_code, code, name) values
    (v_tenant,'PROFIT_CENTER','#'    ,'Not Assigned'),
    (v_tenant,'PROFIT_CENTER','PC100','Manufacturing'),
    (v_tenant,'PROFIT_CENTER','PC200','Distribution'),
    (v_tenant,'PROFIT_CENTER','PC300','Corporate'),
    (v_tenant,'SEGMENT'      ,'#'    ,'Not Assigned'),
    (v_tenant,'SEGMENT'      ,'SEG_A','Industrial'),
    (v_tenant,'SEGMENT'      ,'SEG_B','Consumer')
  on conflict (tenant_id, dim_code, code) do nothing;

  -- --------------------------------------------------- consolidation group
  insert into dim_cons_group (tenant_id, code, name, group_currency)
  values (v_tenant, 'GRP_WW', 'Worldwide Group', 'USD')
  on conflict (tenant_id, code) do update set name = excluded.name
  returning id into v_group;

  insert into cons_group_member (tenant_id, cons_group_id, entity_id, cons_method,
                                 direct_ownership_pct, group_share_pct,
                                 first_cons_year, first_cons_period)
  select v_tenant, v_group, e.id, m.method, m.pct, m.pct, 2025, 1
    from (values
      ('PARENT'  ,'PURCHASE'     ,100.0),
      ('SUB_US'  ,'PURCHASE'     ,100.0),
      ('SUB_EU'  ,'PURCHASE'     , 80.0),
      ('JV_SA'   ,'PROPORTIONATE', 50.0),
      ('ASSOC_IN','EQUITY'       , 30.0)
    ) as m(code, method, pct)
    join dim_entity e on e.tenant_id = v_tenant and e.code = m.code
  on conflict (tenant_id, cons_group_id, entity_id) do update
    set cons_method = excluded.cons_method, group_share_pct = excluded.group_share_pct;

  -- --------------------------------------------------------------- fx rates
  -- Held flat within each year so results can be checked by hand.
  insert into fx_rate (tenant_id, rate_type, from_currency, to_currency,
                       fiscal_year, period, rate, version_id)
  select v_tenant, r.rate_type, r.ccy, 'USD', r.yr, p.period, r.rate, v_version
    from (values
      ('CLOSING','EUR',2025,1.20000000), ('AVERAGE','EUR',2025,1.18000000), ('OPENING','EUR',2025,1.15000000),
      ('CLOSING','EUR',2026,1.25000000), ('AVERAGE','EUR',2026,1.20000000), ('OPENING','EUR',2026,1.20000000),
      ('CLOSING','SAR',2025,0.25000000), ('AVERAGE','SAR',2025,0.25000000), ('OPENING','SAR',2025,0.25000000),
      ('CLOSING','SAR',2026,0.25000000), ('AVERAGE','SAR',2026,0.25000000), ('OPENING','SAR',2026,0.25000000),
      ('CLOSING','INR',2025,0.01300000), ('AVERAGE','INR',2025,0.01280000), ('OPENING','INR',2025,0.01350000),
      ('CLOSING','INR',2026,0.01250000), ('AVERAGE','INR',2026,0.01200000), ('OPENING','INR',2026,0.01300000),
      ('CLOSING','USD',2025,1.00000000), ('AVERAGE','USD',2025,1.00000000), ('OPENING','USD',2025,1.00000000),
      ('CLOSING','USD',2026,1.00000000), ('AVERAGE','USD',2026,1.00000000), ('OPENING','USD',2026,1.00000000)
    ) as r(rate_type, ccy, yr, rate)
    cross join generate_series(0, 12) as p(period)
  on conflict (tenant_id, rate_type, from_currency, to_currency, fiscal_year, period, version_id)
    do update set rate = excluded.rate;


  -- Historical rates for equity, so translation produces a real cumulative
  -- translation adjustment instead of a trivially zero one. Equity is frozen at
  -- the rate on acquisition while assets and liabilities move to the closing
  -- rate; the gap is the CTA. Fixed assets have no row here and fall back to the
  -- closing rate, which is the ordinary IAS 21 closing-rate outcome.
  insert into historical_rate (tenant_id, entity_id, account_id, rate,
                               valid_from_year, valid_from_period)
  select v_tenant, e.id, a.id, h.rate, h.yr, 1
    from (values
      ('SUB_EU'  , 1.10000000, 2020),
      ('JV_SA'   , 0.26000000, 2021),
      ('ASSOC_IN', 0.01400000, 2022)
    ) as h(entity_code, rate, yr)
    join dim_entity e on e.tenant_id = v_tenant and e.code = h.entity_code
    join dim_account a on a.tenant_id = v_tenant
                      and a.code in ('3000','3010','3100','3300');

  -- ---------------------------------------------------------- period status
  insert into period_status (tenant_id, fiscal_year, period, version_id, cons_group_id, status)
  select v_tenant, y.yr, p.period, v_version, null, 'OPEN'
    from generate_series(2025, 2026) as y(yr)
    cross join generate_series(0, 12) as p(period)
  on conflict (tenant_id, fiscal_year, period, version_id, cons_group_id) do nothing;

  -- ------------------------------------------------------------ hierarchies
  insert into dim_hierarchy (tenant_id, dim_code, hierarchy_code, hierarchy_name)
  values (v_tenant, 'ACCOUNT', 'AH_STD', 'Statutory statements')
  on conflict (tenant_id, dim_code, hierarchy_code) do update
    set hierarchy_name = excluded.hierarchy_name
  returning id into v_hier;

  insert into dim_hierarchy_node (tenant_id, hierarchy_id, member_code, parent_member_code,
                                  node_order, aggregation_sign)
  select v_tenant, v_hier, n.member, n.parent, n.ord, n.sign
    from (values
      ('TOTAL'      , null        ,  10, 1),
      ('BS'         , 'TOTAL'     ,  20, 1),
      ('ASSETS'     , 'BS'        ,  30, 1),
      ('CURR_ASSET' , 'ASSETS'    ,  40, 1),
      ('NCURR_ASSET', 'ASSETS'    ,  50, 1),
      ('LIAB'       , 'BS'        ,  60, 1),
      ('EQUITY'     , 'BS'        ,  70, 1),
      ('PL'         , 'TOTAL'     ,  80, 1),
      ('INCOME'     , 'PL'        ,  90, 1),
      ('EXPENSE'    , 'PL'        , 100, 1)
    ) as n(member, parent, ord, sign)
  on conflict (tenant_id, hierarchy_id, member_code) do nothing;

  -- account leaves hang off the right subtotal by code range
  insert into dim_hierarchy_node (tenant_id, hierarchy_id, member_code, parent_member_code,
                                  node_order, aggregation_sign)
  select v_tenant, v_hier, a.code,
         case
           when a.code < '1400' then 'CURR_ASSET'
           when a.code < '2000' then 'NCURR_ASSET'
           when a.code < '3000' then 'LIAB'
           when a.code < '4000' then 'EQUITY'
           when a.code < '5000' then 'INCOME'
           else 'EXPENSE'
         end,
         a.code::int, 1
    from dim_account a
   where a.tenant_id = v_tenant
  on conflict (tenant_id, hierarchy_id, member_code) do nothing;

  -- ---------------------------------------------------------- reported data
  -- Trial balances for FY2025 P12 and FY2026 P12, in local currency, signed
  -- debit-positive. Retained earnings (3100) is omitted here and derived
  -- afterwards as the balancing figure.
  create temporary table _tb (
    entity_code text, account_code text, movement_code text, partner_code text,
    amt_2025 numeric(23,2), amt_2026 numeric(23,2)
  ) on commit drop;

  insert into _tb values
    -- PARENT (USD)
    ('PARENT','1000',null ,null      ,  4200000,  5000000),
    ('PARENT','1100',null ,null      ,  2900000,  3200000),
    ('PARENT','1110',null ,'SUB_EU'  ,   700000,   800000),
    ('PARENT','1130',null ,'SUB_US'  ,  2000000,  2000000),
    ('PARENT','1200',null ,null      ,  1400000,  1500000),
    ('PARENT','1400','199',null      , 11000000, 12000000),
    ('PARENT','1410','199',null      , -3600000, -4000000),
    ('PARENT','1700','199','SUB_US'  ,  2000000,  2000000),
    ('PARENT','1700','199','SUB_EU'  ,  6400000,  6400000),
    ('PARENT','1710','199','JV_SA'   ,  1500000,  1500000),
    ('PARENT','1710','199','ASSOC_IN',   900000,   900000),
    ('PARENT','2000',null ,null      , -1900000, -2100000),
    ('PARENT','2210',null ,null      , -6000000, -6000000),
    ('PARENT','3000','199',null      ,-10000000,-10000000),
    ('PARENT','4000',null ,null      ,-16500000,-18000000),
    ('PARENT','4010',null ,'SUB_EU'  , -1100000, -1200000),
    ('PARENT','4300',null ,'SUB_US'  ,  -120000,  -120000),
    ('PARENT','5000',null ,null      ,  9200000, 10000000),
    ('PARENT','5100',null ,null      ,  3300000,  3500000),
    ('PARENT','5300',null ,null      ,   400000,   450000),
    ('PARENT','5500',null ,null      ,   850000,   900000),
    ('PARENT','5900',null ,null      ,   950000,  1000000),
    -- SUB_US (USD, 100% purchase)
    ('SUB_US','1000',null ,null      ,   900000,  1100000),
    ('SUB_US','1100',null ,null      ,  1200000,  1400000),
    ('SUB_US','1110',null ,'JV_SA'   ,   450000,   500000),
    ('SUB_US','1200',null ,null      ,   600000,   700000),
    ('SUB_US','1400','199',null      ,  3000000,  3200000),
    ('SUB_US','1410','199',null      , -1100000, -1300000),
    ('SUB_US','2000',null ,null      ,  -800000,  -900000),
    ('SUB_US','2220',null ,'PARENT'  , -2000000, -2000000),
    ('SUB_US','3000','199',null      , -1000000, -1000000),
    ('SUB_US','4000',null ,null      , -6000000, -6800000),
    ('SUB_US','5000',null ,null      ,  3600000,  4100000),
    ('SUB_US','5100',null ,null      ,  1200000,  1350000),
    ('SUB_US','5500',null ,null      ,   280000,   300000),
    ('SUB_US','5600',null ,'PARENT'  ,   120000,   120000),
    ('SUB_US','5900',null ,null      ,   180000,   210000),
    -- SUB_EU (EUR, 80% purchase)
    ('SUB_EU','1000',null ,null      ,   700000,   850000),
    ('SUB_EU','1100',null ,null      ,  1500000,  1700000),
    ('SUB_EU','1110',null ,'ASSOC_IN',    80000,   100000),
    ('SUB_EU','1200',null ,null      ,   900000,   950000),
    ('SUB_EU','1400','199',null      ,  4000000,  4400000),
    ('SUB_EU','1410','199',null      , -1500000, -1750000),
    ('SUB_EU','2000',null ,null      , -1100000, -1250000),
    ('SUB_EU','2010',null ,'PARENT'  ,  -560000,  -640000),
    ('SUB_EU','2210',null ,null      , -1500000, -1500000),
    ('SUB_EU','3000','199',null      , -2000000, -2000000),
    ('SUB_EU','4000',null ,null      , -7200000, -7900000),
    ('SUB_EU','5000',null ,null      ,  4100000,  4500000),
    ('SUB_EU','5010',null ,'PARENT'  ,   930000,  1000000),
    ('SUB_EU','5100',null ,null      ,  1500000,  1650000),
    ('SUB_EU','5500',null ,null      ,   350000,   380000),
    ('SUB_EU','5900',null ,null      ,   190000,   220000),
    -- JV_SA (SAR, 50% proportionate)
    ('JV_SA','1000',null ,null     ,  1800000,  2100000),
    ('JV_SA','1100',null ,null     ,  3200000,  3600000),
    ('JV_SA','1200',null ,null     ,  1500000,  1700000),
    ('JV_SA','1400','199',null     ,  8000000,  8600000),
    ('JV_SA','1410','199',null     , -2800000, -3200000),
    ('JV_SA','2000',null ,null     , -2400000, -2700000),
    ('JV_SA','2010',null ,'SUB_US' , -1600000, -1800000),
    ('JV_SA','2210',null ,null     , -3000000, -3000000),
    ('JV_SA','3000','199',null     , -4000000, -4000000),
    ('JV_SA','4000',null ,null     ,-12000000,-13500000),
    ('JV_SA','5000',null ,null     ,  7200000,  8100000),
    ('JV_SA','5100',null ,null     ,  2400000,  2700000),
    ('JV_SA','5500',null ,null     ,   700000,   780000),
    ('JV_SA','5900',null ,null     ,   340000,   400000),
    -- ASSOC_IN (INR, 30% equity)
    ('ASSOC_IN','1000',null ,null,  12000000,  14000000),
    ('ASSOC_IN','1100',null ,null,  28000000,  32000000),
    ('ASSOC_IN','1200',null ,null,  15000000,  17000000),
    ('ASSOC_IN','1400','199',null,  60000000,  66000000),
    ('ASSOC_IN','1410','199',null, -22000000, -26000000),
    ('ASSOC_IN','2000',null ,null, -18000000, -20000000),
    ('ASSOC_IN','2210',null ,null, -25000000, -25000000),
    ('ASSOC_IN','3000','199',null, -30000000, -30000000),
    ('ASSOC_IN','4000',null ,null, -95000000,-105000000),
    ('ASSOC_IN','5000',null ,null,  57000000,  63000000),
    ('ASSOC_IN','5100',null ,null,  19000000,  21000000),
    ('ASSOC_IN','5500',null ,null,   5500000,   6000000),
    ('ASSOC_IN','5900',null ,null,   2800000,   3200000);

  -- retained earnings as the balancing figure, per entity per year
  insert into _tb
  select entity_code, '3100', '199', null, -sum(amt_2025), -sum(amt_2026)
    from _tb group by entity_code;

  foreach v_year in array array[2025, 2026]
  loop
    insert into task_run (tenant_id, task_type, version_id, fiscal_year, period,
                          status, started_at, finished_at, message)
    values (v_tenant, 'UPLOAD', v_version, v_year, 12, 'SUCCESS', now(), now(),
            'Demo dataset')
    returning id into v_task;

    insert into journal_header (tenant_id, doc_type, posting_level, fiscal_year,
                                period, version_id, task_run_id, description)
    values (v_tenant, 'UPLOAD', '00', v_year, 12, v_version, v_task,
            format('Demo trial balance %s/12', v_year))
    returning id into v_journal;

    insert into fact_balances (
      tenant_id, entity_id, account_id, movement_id, partner_id, version_id,
      fiscal_year, period, posting_level, zdim01, zdim02,
      transaction_currency, local_currency, group_currency,
      amount_tc, amount_lc, amount_gc,
      journal_id, task_run_id, source_task)
    select v_tenant, e.id, a.id, m.id, p.id, v_version,
           v_year, 12, '00', '#', '#',
           e.local_currency, e.local_currency, e.local_currency,
           t.amt, t.amt, 0,
           v_journal, v_task, 'UPLOAD'
      from (
        select entity_code, account_code, movement_code, partner_code,
               case when v_year = 2025 then amt_2025 else amt_2026 end as amt
          from _tb
      ) t
      join dim_entity  e on e.tenant_id = v_tenant and e.code = t.entity_code
      join dim_account a on a.tenant_id = v_tenant and a.code = t.account_code
      left join dim_movement m on m.tenant_id = v_tenant and m.code = t.movement_code
      left join dim_entity   p on p.tenant_id = v_tenant and p.code = t.partner_code
     where t.amt <> 0;

    get diagnostics v_rows = row_count;
    update task_run set rows_written = v_rows, journal_id = v_journal where id = v_task;
  end loop;

  -- --------------------------------------------------------------- rules
  -- A default rule of every kind, so each engine screen has something to run
  -- the moment it is built. These are ordinary rows: edit or delete them in
  -- the UI like any other.

  insert into rule_bcf (tenant_id, code, name, source_account_filter,
      source_movement_class, target_movement_code, carry_partner,
      carry_custom_dims, pl_to_retained_earnings, retained_earnings_account_code,
      sequence, is_active)
  values (v_tenant, 'BCF01', 'Balance sheet carry forward',
      '{}'::jsonb, array['CLOSING'], '100', true, true, true, '3100', 100, true)
  on conflict (tenant_id, code) do update set name = excluded.name;

  insert into rule_net_income (tenant_id, code, name, source_account_filter,
      target_bs_account_code, target_movement_code, split_to_minority,
      minority_account_code, sequence, is_active)
  values (v_tenant, 'NI01', 'Profit or loss to equity',
      '{"op":"AND","conditions":[{"field":"statement_type","operator":"eq","value":"PL"}]}'::jsonb,
      '3200', '199', true, '3500', 100, true)
  on conflict (tenant_id, code) do update set name = excluded.name;

  insert into rule_translation (tenant_id, code, name, account_filter, rate_type,
      historical_rate_source, post_difference_to, difference_scope, sequence, is_active)
  values
    (v_tenant, 'TR_BS', 'Balance sheet at closing rate',
     '{"op":"AND","conditions":[{"field":"statement_type","operator":"eq","value":"BS"},{"field":"translation_method","operator":"eq","value":"CLOSING"}]}'::jsonb,
     'CLOSING', 'ACQUISITION', '3400', 'BS', 10, true),
    (v_tenant, 'TR_NI', 'Net income in equity at average rate',
     '{"op":"AND","conditions":[{"field":"statement_type","operator":"eq","value":"BS"},{"field":"translation_method","operator":"eq","value":"AVERAGE"}]}'::jsonb,
     'AVERAGE', 'ACQUISITION', '3400', 'EQUITY', 15, true),
    (v_tenant, 'TR_PL', 'Profit and loss at average rate',
     '{"op":"AND","conditions":[{"field":"statement_type","operator":"eq","value":"PL"}]}'::jsonb,
     'AVERAGE', 'ACQUISITION', '3400', 'PL', 20, true),
    (v_tenant, 'TR_HIST', 'Equity and fixed assets at historical rate',
     '{"op":"AND","conditions":[{"field":"translation_method","operator":"eq","value":"HISTORICAL"}]}'::jsonb,
     'HISTORICAL', 'ACQUISITION', '3400', 'EQUITY', 30, true)
  on conflict (tenant_id, code) do update set name = excluded.name;

  insert into rule_ic_elim (tenant_id, code, name, elimination_group,
      leg1_account_filter, leg2_account_filter, is_two_sided,
      difference_threshold_abs, difference_threshold_pct,
      currency_diff_account_code, real_diff_account_code,
      posting_level, post_in_currency, sequence, is_active)
  values
    (v_tenant, 'ICE_TRADE_BS', 'Intercompany receivables against payables', 'IC_TRADE_BS',
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"1110"}]}'::jsonb,
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"2010"}]}'::jsonb,
     true, 1000, 0.5, '4600', '5950', '10', 'GC', 10, true),
    (v_tenant, 'ICE_TRADE_PL', 'Intercompany revenue against purchases', 'IC_TRADE_PL',
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"4010"}]}'::jsonb,
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"5010"}]}'::jsonb,
     true, 1000, 0.5, '4600', '5950', '10', 'GC', 20, true),
    (v_tenant, 'ICE_LOAN', 'Intercompany loans', 'IC_LOAN',
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"1130"}]}'::jsonb,
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"2220"}]}'::jsonb,
     true, 0, 0, '4600', '5950', '10', 'GC', 30, true),
    (v_tenant, 'ICE_INT', 'Intercompany interest', 'IC_INT',
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"4300"}]}'::jsonb,
     '{"op":"AND","conditions":[{"field":"code","operator":"eq","value":"5600"}]}'::jsonb,
     true, 0, 0, '4600', '5950', '10', 'GC', 40, true)
  on conflict (tenant_id, code) do update set name = excluded.name;

  insert into rule_coi (tenant_id, code, name, cons_method, investment_account_code,
      equity_account_filter, goodwill_account_code, badwill_account_code,
      nci_equity_account_code, nci_pl_account_code, equity_pickup_account_code,
      equity_income_account_code, goodwill_amortisation_account_code,
      posting_level, sequence, is_active)
  values
    (v_tenant, 'COI_PURCHASE', 'Acquisition method', 'PURCHASE', '1700',
     '{"op":"AND","conditions":[{"field":"is_equity_account","operator":"is_true"}]}'::jsonb,
     '1600', '4700', '3500', '5980', null, null, '5800', '20', 10, true),
    (v_tenant, 'COI_PROPORTIONATE', 'Proportionate consolidation', 'PROPORTIONATE', '1710',
     '{"op":"AND","conditions":[{"field":"is_equity_account","operator":"is_true"}]}'::jsonb,
     '1600', '4700', null, null, null, null, '5800', '20', 20, true),
    (v_tenant, 'COI_EQUITY', 'Equity method', 'EQUITY', '1710',
     '{"op":"AND","conditions":[{"field":"is_equity_account","operator":"is_true"}]}'::jsonb,
     null, null, null, null, '1720', '4500', null, '20', 30, true)
  on conflict (tenant_id, code) do update set name = excluded.name;

  return jsonb_build_object(
    'tenant_id'    , v_tenant,
    'version_id'   , v_version,
    'cons_group_id', v_group,
    'entities'     , (select count(*) from dim_entity   where tenant_id = v_tenant),
    'accounts'     , (select count(*) from dim_account  where tenant_id = v_tenant),
    'fx_rates'     , (select count(*) from fx_rate      where tenant_id = v_tenant),
    'rules'        , (select count(*) from rule_bcf where tenant_id = v_tenant)
                   + (select count(*) from rule_net_income where tenant_id = v_tenant)
                   + (select count(*) from rule_translation where tenant_id = v_tenant)
                   + (select count(*) from rule_ic_elim where tenant_id = v_tenant)
                   + (select count(*) from rule_coi where tenant_id = v_tenant),
    'fact_rows'    , (select count(*) from fact_balances where tenant_id = v_tenant)
  );
end
$function$
;
