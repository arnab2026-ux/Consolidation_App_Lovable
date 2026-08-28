export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      app_user: {
        Row: {
          id: string,
          tenant_id: string,
          email: string,
          role: string,
          created_at: string | null
        }
        Insert: {
          id: string,
          tenant_id: string,
          email: string,
          role?: string,
          created_at?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          email?: string,
          role?: string,
          created_at?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "app_user_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      cons_group_member: {
        Row: {
          id: string,
          tenant_id: string,
          cons_group_id: string,
          entity_id: string,
          cons_method: string,
          direct_ownership_pct: number,
          group_share_pct: number,
          minority_pct: number | null,
          first_cons_year: number | null,
          first_cons_period: number | null,
          last_cons_year: number | null,
          last_cons_period: number | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          cons_group_id: string,
          entity_id: string,
          cons_method: string,
          direct_ownership_pct?: number,
          group_share_pct?: number,
          minority_pct?: number | null,
          first_cons_year?: number | null,
          first_cons_period?: number | null,
          last_cons_year?: number | null,
          last_cons_period?: number | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          cons_group_id?: string,
          entity_id?: string,
          cons_method?: string,
          direct_ownership_pct?: number,
          group_share_pct?: number,
          minority_pct?: number | null,
          first_cons_year?: number | null,
          first_cons_period?: number | null,
          last_cons_year?: number | null,
          last_cons_period?: number | null
        }
        Relationships: [
        {
          foreignKeyName: "cons_group_member_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "cons_group_member_entity_id_fkey"
          columns: ["entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "cons_group_member_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_account: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          statement_type: string,
          account_class: string,
          normal_balance: string,
          requires_partner: boolean | null,
          requires_movement: boolean | null,
          is_intercompany: boolean | null,
          elimination_group: string | null,
          translation_method: string | null,
          is_investment_account: boolean | null,
          is_equity_account: boolean | null,
          is_retained_earnings: boolean | null,
          is_net_income: boolean | null,
          is_active: boolean | null,
          attributes: Json | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          statement_type: string,
          account_class: string,
          normal_balance: string,
          requires_partner?: boolean | null,
          requires_movement?: boolean | null,
          is_intercompany?: boolean | null,
          elimination_group?: string | null,
          translation_method?: string | null,
          is_investment_account?: boolean | null,
          is_equity_account?: boolean | null,
          is_retained_earnings?: boolean | null,
          is_net_income?: boolean | null,
          is_active?: boolean | null,
          attributes?: Json | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          statement_type?: string,
          account_class?: string,
          normal_balance?: string,
          requires_partner?: boolean | null,
          requires_movement?: boolean | null,
          is_intercompany?: boolean | null,
          elimination_group?: string | null,
          translation_method?: string | null,
          is_investment_account?: boolean | null,
          is_equity_account?: boolean | null,
          is_retained_earnings?: boolean | null,
          is_net_income?: boolean | null,
          is_active?: boolean | null,
          attributes?: Json | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_account_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_cons_group: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          group_currency: string,
          parent_group_id: string | null,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          group_currency: string,
          parent_group_id?: string | null,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          group_currency?: string,
          parent_group_id?: string | null,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_cons_group_parent_group_id_fkey"
          columns: ["parent_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "dim_cons_group_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_currency: {
        Row: {
          code: string,
          name: string,
          decimals: number | null
        }
        Insert: {
          code: string,
          name: string,
          decimals?: number | null
        }
        Update: {
          code?: string,
          name?: string,
          decimals?: number | null
        }
        Relationships: []
      }
      dim_entity: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          local_currency: string,
          country: string | null,
          entity_type: string | null,
          default_cons_method: string | null,
          acquisition_date: string | null,
          divestment_date: string | null,
          is_active: boolean | null,
          attributes: Json | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          local_currency: string,
          country?: string | null,
          entity_type?: string | null,
          default_cons_method?: string | null,
          acquisition_date?: string | null,
          divestment_date?: string | null,
          is_active?: boolean | null,
          attributes?: Json | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          local_currency?: string,
          country?: string | null,
          entity_type?: string | null,
          default_cons_method?: string | null,
          acquisition_date?: string | null,
          divestment_date?: string | null,
          is_active?: boolean | null,
          attributes?: Json | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_entity_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_generic_member: {
        Row: {
          id: string,
          tenant_id: string,
          dim_code: string,
          code: string,
          name: string,
          parent_code: string | null,
          is_active: boolean | null,
          attributes: Json | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          dim_code: string,
          code: string,
          name: string,
          parent_code?: string | null,
          is_active?: boolean | null,
          attributes?: Json | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          dim_code?: string,
          code?: string,
          name?: string,
          parent_code?: string | null,
          is_active?: boolean | null,
          attributes?: Json | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_generic_member_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_hierarchy: {
        Row: {
          id: string,
          tenant_id: string,
          dim_code: string,
          hierarchy_code: string,
          hierarchy_name: string
        }
        Insert: {
          id?: string,
          tenant_id: string,
          dim_code: string,
          hierarchy_code: string,
          hierarchy_name: string
        }
        Update: {
          id?: string,
          tenant_id?: string,
          dim_code?: string,
          hierarchy_code?: string,
          hierarchy_name?: string
        }
        Relationships: [
        {
          foreignKeyName: "dim_hierarchy_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_hierarchy_node: {
        Row: {
          id: string,
          tenant_id: string,
          hierarchy_id: string,
          member_code: string,
          parent_member_code: string | null,
          node_order: number | null,
          aggregation_sign: number | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          hierarchy_id: string,
          member_code: string,
          parent_member_code?: string | null,
          node_order?: number | null,
          aggregation_sign?: number | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          hierarchy_id?: string,
          member_code?: string,
          parent_member_code?: string | null,
          node_order?: number | null,
          aggregation_sign?: number | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_hierarchy_node_hierarchy_id_fkey"
          columns: ["hierarchy_id"]
          isOneToOne: false
          referencedRelation: "dim_hierarchy"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "dim_hierarchy_node_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_movement: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          movement_class: string,
          is_bcf_target: boolean | null,
          is_bcf_source: boolean | null,
          cash_flow_relevant: boolean | null,
          display_order: number | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          movement_class: string,
          is_bcf_target?: boolean | null,
          is_bcf_source?: boolean | null,
          cash_flow_relevant?: boolean | null,
          display_order?: number | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          movement_class?: string,
          is_bcf_target?: boolean | null,
          is_bcf_source?: boolean | null,
          cash_flow_relevant?: boolean | null,
          display_order?: number | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_movement_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_registry: {
        Row: {
          id: string,
          tenant_id: string,
          dim_code: string,
          dim_name: string,
          is_mandatory: boolean,
          is_active: boolean,
          physical_column: string,
          master_table: string | null,
          is_hierarchical: boolean | null,
          requires_partner: boolean | null,
          display_order: number | null,
          created_at: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          dim_code: string,
          dim_name: string,
          is_mandatory?: boolean,
          is_active?: boolean,
          physical_column: string,
          master_table?: string | null,
          is_hierarchical?: boolean | null,
          requires_partner?: boolean | null,
          display_order?: number | null,
          created_at?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          dim_code?: string,
          dim_name?: string,
          is_mandatory?: boolean,
          is_active?: boolean,
          physical_column?: string,
          master_table?: string | null,
          is_hierarchical?: boolean | null,
          requires_partner?: boolean | null,
          display_order?: number | null,
          created_at?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_registry_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      dim_version: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          version_type: string | null,
          is_locked: boolean | null,
          copy_source_version: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          version_type?: string | null,
          is_locked?: boolean | null,
          copy_source_version?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          version_type?: string | null,
          is_locked?: boolean | null,
          copy_source_version?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "dim_version_copy_source_version_fkey"
          columns: ["copy_source_version"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "dim_version_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      fact_balances: {
        Row: {
          id: number,
          tenant_id: string,
          entity_id: string,
          account_id: string,
          movement_id: string | null,
          partner_id: string | null,
          cons_group_id: string | null,
          version_id: string,
          fiscal_year: number,
          period: number,
          posting_level: string,
          zdim01: string | null,
          zdim02: string | null,
          zdim03: string | null,
          zdim04: string | null,
          zdim05: string | null,
          zdim06: string | null,
          zdim07: string | null,
          zdim08: string | null,
          zdim09: string | null,
          zdim10: string | null,
          transaction_currency: string | null,
          local_currency: string,
          group_currency: string,
          amount_tc: number | null,
          amount_lc: number,
          amount_gc: number,
          quantity: number | null,
          journal_id: string | null,
          task_run_id: string | null,
          source_task: string,
          created_at: string | null
        }
        Insert: {
          id?: number,
          tenant_id: string,
          entity_id: string,
          account_id: string,
          movement_id?: string | null,
          partner_id?: string | null,
          cons_group_id?: string | null,
          version_id: string,
          fiscal_year: number,
          period: number,
          posting_level?: string,
          zdim01?: string | null,
          zdim02?: string | null,
          zdim03?: string | null,
          zdim04?: string | null,
          zdim05?: string | null,
          zdim06?: string | null,
          zdim07?: string | null,
          zdim08?: string | null,
          zdim09?: string | null,
          zdim10?: string | null,
          transaction_currency?: string | null,
          local_currency: string,
          group_currency: string,
          amount_tc?: number | null,
          amount_lc?: number,
          amount_gc?: number,
          quantity?: number | null,
          journal_id?: string | null,
          task_run_id?: string | null,
          source_task?: string,
          created_at?: string | null
        }
        Update: {
          id?: number,
          tenant_id?: string,
          entity_id?: string,
          account_id?: string,
          movement_id?: string | null,
          partner_id?: string | null,
          cons_group_id?: string | null,
          version_id?: string,
          fiscal_year?: number,
          period?: number,
          posting_level?: string,
          zdim01?: string | null,
          zdim02?: string | null,
          zdim03?: string | null,
          zdim04?: string | null,
          zdim05?: string | null,
          zdim06?: string | null,
          zdim07?: string | null,
          zdim08?: string | null,
          zdim09?: string | null,
          zdim10?: string | null,
          transaction_currency?: string | null,
          local_currency?: string,
          group_currency?: string,
          amount_tc?: number | null,
          amount_lc?: number,
          amount_gc?: number,
          quantity?: number | null,
          journal_id?: string | null,
          task_run_id?: string | null,
          source_task?: string,
          created_at?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "fact_balances_account_id_fkey"
          columns: ["account_id"]
          isOneToOne: false
          referencedRelation: "dim_account"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_entity_id_fkey"
          columns: ["entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_journal_id_fkey"
          columns: ["journal_id"]
          isOneToOne: false
          referencedRelation: "journal_header"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_movement_id_fkey"
          columns: ["movement_id"]
          isOneToOne: false
          referencedRelation: "dim_movement"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_partner_id_fkey"
          columns: ["partner_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fact_balances_version_id_fkey"
          columns: ["version_id"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        }
        ]
      }
      fx_rate: {
        Row: {
          id: string,
          tenant_id: string,
          rate_type: string,
          from_currency: string,
          to_currency: string,
          fiscal_year: number,
          period: number,
          rate: number,
          version_id: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          rate_type: string,
          from_currency: string,
          to_currency: string,
          fiscal_year: number,
          period: number,
          rate: number,
          version_id?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          rate_type?: string,
          from_currency?: string,
          to_currency?: string,
          fiscal_year?: number,
          period?: number,
          rate?: number,
          version_id?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "fx_rate_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "fx_rate_version_id_fkey"
          columns: ["version_id"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        }
        ]
      }
      historical_rate: {
        Row: {
          id: string,
          tenant_id: string,
          entity_id: string,
          account_id: string,
          movement_id: string | null,
          rate: number,
          valid_from_year: number | null,
          valid_from_period: number | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          entity_id: string,
          account_id: string,
          movement_id?: string | null,
          rate: number,
          valid_from_year?: number | null,
          valid_from_period?: number | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          entity_id?: string,
          account_id?: string,
          movement_id?: string | null,
          rate?: number,
          valid_from_year?: number | null,
          valid_from_period?: number | null
        }
        Relationships: [
        {
          foreignKeyName: "historical_rate_account_id_fkey"
          columns: ["account_id"]
          isOneToOne: false
          referencedRelation: "dim_account"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "historical_rate_entity_id_fkey"
          columns: ["entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "historical_rate_movement_id_fkey"
          columns: ["movement_id"]
          isOneToOne: false
          referencedRelation: "dim_movement"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "historical_rate_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      ic_reconciliation: {
        Row: {
          id: number,
          tenant_id: string,
          task_run_id: string | null,
          cons_group_id: string | null,
          fiscal_year: number | null,
          period: number | null,
          version_id: string | null,
          entity_id: string | null,
          partner_id: string | null,
          rule_id: string | null,
          leg1_amount_gc: number | null,
          leg2_amount_gc: number | null,
          difference_gc: number | null,
          status: string | null
        }
        Insert: {
          id?: number,
          tenant_id: string,
          task_run_id?: string | null,
          cons_group_id?: string | null,
          fiscal_year?: number | null,
          period?: number | null,
          version_id?: string | null,
          entity_id?: string | null,
          partner_id?: string | null,
          rule_id?: string | null,
          leg1_amount_gc?: number | null,
          leg2_amount_gc?: number | null,
          difference_gc?: number | null,
          status?: string | null
        }
        Update: {
          id?: number,
          tenant_id?: string,
          task_run_id?: string | null,
          cons_group_id?: string | null,
          fiscal_year?: number | null,
          period?: number | null,
          version_id?: string | null,
          entity_id?: string | null,
          partner_id?: string | null,
          rule_id?: string | null,
          leg1_amount_gc?: number | null,
          leg2_amount_gc?: number | null,
          difference_gc?: number | null,
          status?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "ic_reconciliation_rule_id_fkey"
          columns: ["rule_id"]
          isOneToOne: false
          referencedRelation: "rule_ic_elim"
          referencedColumns: ["id"]
        }
        ]
      }
      investment_register: {
        Row: {
          id: string,
          tenant_id: string,
          cons_group_id: string,
          investor_entity_id: string,
          investee_entity_id: string,
          activity: string,
          fiscal_year: number,
          period: number,
          cons_method: string,
          ownership_pct_before: number | null,
          ownership_pct_after: number,
          investment_cost_gc: number | null,
          fair_value_adjustment_gc: number | null,
          net_assets_acquired_gc: number | null,
          goodwill_gc: number | null,
          nci_measurement: string | null,
          is_posted: boolean | null,
          notes: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          cons_group_id: string,
          investor_entity_id: string,
          investee_entity_id: string,
          activity: string,
          fiscal_year: number,
          period: number,
          cons_method: string,
          ownership_pct_before?: number | null,
          ownership_pct_after: number,
          investment_cost_gc?: number | null,
          fair_value_adjustment_gc?: number | null,
          net_assets_acquired_gc?: number | null,
          goodwill_gc?: number | null,
          nci_measurement?: string | null,
          is_posted?: boolean | null,
          notes?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          cons_group_id?: string,
          investor_entity_id?: string,
          investee_entity_id?: string,
          activity?: string,
          fiscal_year?: number,
          period?: number,
          cons_method?: string,
          ownership_pct_before?: number | null,
          ownership_pct_after?: number,
          investment_cost_gc?: number | null,
          fair_value_adjustment_gc?: number | null,
          net_assets_acquired_gc?: number | null,
          goodwill_gc?: number | null,
          nci_measurement?: string | null,
          is_posted?: boolean | null,
          notes?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "investment_register_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "investment_register_investee_entity_id_fkey"
          columns: ["investee_entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "investment_register_investor_entity_id_fkey"
          columns: ["investor_entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "investment_register_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      journal_header: {
        Row: {
          id: string,
          tenant_id: string,
          doc_number: number,
          doc_type: string,
          posting_level: string,
          fiscal_year: number,
          period: number,
          version_id: string,
          cons_group_id: string | null,
          task_run_id: string | null,
          description: string | null,
          is_reversed: boolean | null,
          reversed_by: string | null,
          created_by: string | null,
          created_at: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          doc_number?: number,
          doc_type: string,
          posting_level: string,
          fiscal_year: number,
          period: number,
          version_id: string,
          cons_group_id?: string | null,
          task_run_id?: string | null,
          description?: string | null,
          is_reversed?: boolean | null,
          reversed_by?: string | null,
          created_by?: string | null,
          created_at?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          doc_number?: number,
          doc_type?: string,
          posting_level?: string,
          fiscal_year?: number,
          period?: number,
          version_id?: string,
          cons_group_id?: string | null,
          task_run_id?: string | null,
          description?: string | null,
          is_reversed?: boolean | null,
          reversed_by?: string | null,
          created_by?: string | null,
          created_at?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "journal_header_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "journal_header_created_by_fkey"
          columns: ["created_by"]
          isOneToOne: false
          referencedRelation: "app_user"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "journal_header_reversed_by_fkey"
          columns: ["reversed_by"]
          isOneToOne: false
          referencedRelation: "journal_header"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "journal_header_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "journal_header_version_id_fkey"
          columns: ["version_id"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        }
        ]
      }
      period_status: {
        Row: {
          id: string,
          tenant_id: string,
          fiscal_year: number,
          period: number,
          version_id: string,
          cons_group_id: string | null,
          status: string
        }
        Insert: {
          id?: string,
          tenant_id: string,
          fiscal_year: number,
          period: number,
          version_id: string,
          cons_group_id?: string | null,
          status?: string
        }
        Update: {
          id?: string,
          tenant_id?: string,
          fiscal_year?: number,
          period?: number,
          version_id?: string,
          cons_group_id?: string | null,
          status?: string
        }
        Relationships: [
        {
          foreignKeyName: "period_status_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "period_status_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "period_status_version_id_fkey"
          columns: ["version_id"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        }
        ]
      }
      rule_bcf: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          source_account_filter: Json | null,
          source_movement_class: string[] | null,
          target_movement_code: string,
          carry_partner: boolean | null,
          carry_custom_dims: boolean | null,
          pl_to_retained_earnings: boolean | null,
          retained_earnings_account_code: string | null,
          sequence: number | null,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          source_account_filter?: Json | null,
          source_movement_class?: string[] | null,
          target_movement_code: string,
          carry_partner?: boolean | null,
          carry_custom_dims?: boolean | null,
          pl_to_retained_earnings?: boolean | null,
          retained_earnings_account_code?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          source_account_filter?: Json | null,
          source_movement_class?: string[] | null,
          target_movement_code?: string,
          carry_partner?: boolean | null,
          carry_custom_dims?: boolean | null,
          pl_to_retained_earnings?: boolean | null,
          retained_earnings_account_code?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "rule_bcf_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      rule_coi: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          cons_method: string,
          investment_account_code: string,
          equity_account_filter: Json,
          goodwill_account_code: string | null,
          badwill_account_code: string | null,
          nci_equity_account_code: string | null,
          nci_pl_account_code: string | null,
          equity_pickup_account_code: string | null,
          equity_income_account_code: string | null,
          goodwill_amortisation_account_code: string | null,
          posting_level: string | null,
          sequence: number | null,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          cons_method: string,
          investment_account_code: string,
          equity_account_filter: Json,
          goodwill_account_code?: string | null,
          badwill_account_code?: string | null,
          nci_equity_account_code?: string | null,
          nci_pl_account_code?: string | null,
          equity_pickup_account_code?: string | null,
          equity_income_account_code?: string | null,
          goodwill_amortisation_account_code?: string | null,
          posting_level?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          cons_method?: string,
          investment_account_code?: string,
          equity_account_filter?: Json,
          goodwill_account_code?: string | null,
          badwill_account_code?: string | null,
          nci_equity_account_code?: string | null,
          nci_pl_account_code?: string | null,
          equity_pickup_account_code?: string | null,
          equity_income_account_code?: string | null,
          goodwill_amortisation_account_code?: string | null,
          posting_level?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "rule_coi_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      rule_ic_elim: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          elimination_group: string,
          leg1_account_filter: Json,
          leg2_account_filter: Json,
          match_on: string[] | null,
          is_two_sided: boolean | null,
          difference_threshold_abs: number | null,
          difference_threshold_pct: number | null,
          currency_diff_account_code: string | null,
          real_diff_account_code: string | null,
          posting_level: string | null,
          post_in_currency: string | null,
          sequence: number | null,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          elimination_group: string,
          leg1_account_filter: Json,
          leg2_account_filter: Json,
          match_on?: string[] | null,
          is_two_sided?: boolean | null,
          difference_threshold_abs?: number | null,
          difference_threshold_pct?: number | null,
          currency_diff_account_code?: string | null,
          real_diff_account_code?: string | null,
          posting_level?: string | null,
          post_in_currency?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          elimination_group?: string,
          leg1_account_filter?: Json,
          leg2_account_filter?: Json,
          match_on?: string[] | null,
          is_two_sided?: boolean | null,
          difference_threshold_abs?: number | null,
          difference_threshold_pct?: number | null,
          currency_diff_account_code?: string | null,
          real_diff_account_code?: string | null,
          posting_level?: string | null,
          post_in_currency?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "rule_ic_elim_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      rule_net_income: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          source_account_filter: Json | null,
          target_bs_account_code: string,
          target_movement_code: string | null,
          split_to_minority: boolean | null,
          minority_account_code: string | null,
          sequence: number | null,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          source_account_filter?: Json | null,
          target_bs_account_code: string,
          target_movement_code?: string | null,
          split_to_minority?: boolean | null,
          minority_account_code?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          source_account_filter?: Json | null,
          target_bs_account_code?: string,
          target_movement_code?: string | null,
          split_to_minority?: boolean | null,
          minority_account_code?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "rule_net_income_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      rule_translation: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          account_filter: Json | null,
          rate_type: string,
          historical_rate_source: string | null,
          post_difference_to: string | null,
          difference_scope: string | null,
          sequence: number | null,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          account_filter?: Json | null,
          rate_type: string,
          historical_rate_source?: string | null,
          post_difference_to?: string | null,
          difference_scope?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          account_filter?: Json | null,
          rate_type?: string,
          historical_rate_source?: string | null,
          post_difference_to?: string | null,
          difference_scope?: string | null,
          sequence?: number | null,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "rule_translation_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      stg_upload: {
        Row: {
          id: number,
          tenant_id: string,
          batch_id: string,
          row_no: number,
          raw: Json,
          entity_code: string | null,
          account_code: string | null,
          movement_code: string | null,
          partner_code: string | null,
          zdim01: string | null,
          zdim02: string | null,
          zdim03: string | null,
          zdim04: string | null,
          zdim05: string | null,
          zdim06: string | null,
          zdim07: string | null,
          zdim08: string | null,
          zdim09: string | null,
          zdim10: string | null,
          amount_lc: number | null,
          amount_tc: number | null,
          transaction_currency: string | null,
          status: string | null,
          error_msg: string | null
        }
        Insert: {
          id?: number,
          tenant_id: string,
          batch_id: string,
          row_no: number,
          raw: Json,
          entity_code?: string | null,
          account_code?: string | null,
          movement_code?: string | null,
          partner_code?: string | null,
          zdim01?: string | null,
          zdim02?: string | null,
          zdim03?: string | null,
          zdim04?: string | null,
          zdim05?: string | null,
          zdim06?: string | null,
          zdim07?: string | null,
          zdim08?: string | null,
          zdim09?: string | null,
          zdim10?: string | null,
          amount_lc?: number | null,
          amount_tc?: number | null,
          transaction_currency?: string | null,
          status?: string | null,
          error_msg?: string | null
        }
        Update: {
          id?: number,
          tenant_id?: string,
          batch_id?: string,
          row_no?: number,
          raw?: Json,
          entity_code?: string | null,
          account_code?: string | null,
          movement_code?: string | null,
          partner_code?: string | null,
          zdim01?: string | null,
          zdim02?: string | null,
          zdim03?: string | null,
          zdim04?: string | null,
          zdim05?: string | null,
          zdim06?: string | null,
          zdim07?: string | null,
          zdim08?: string | null,
          zdim09?: string | null,
          zdim10?: string | null,
          amount_lc?: number | null,
          amount_tc?: number | null,
          transaction_currency?: string | null,
          status?: string | null,
          error_msg?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "stg_upload_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      task_run: {
        Row: {
          id: string,
          tenant_id: string,
          workflow_run_id: string | null,
          step_id: string | null,
          task_type: string,
          entity_id: string | null,
          cons_group_id: string | null,
          version_id: string | null,
          fiscal_year: number | null,
          period: number | null,
          status: string | null,
          rows_written: number | null,
          journal_id: string | null,
          message: string | null,
          log: Json | null,
          started_at: string | null,
          finished_at: string | null,
          run_by: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          workflow_run_id?: string | null,
          step_id?: string | null,
          task_type: string,
          entity_id?: string | null,
          cons_group_id?: string | null,
          version_id?: string | null,
          fiscal_year?: number | null,
          period?: number | null,
          status?: string | null,
          rows_written?: number | null,
          journal_id?: string | null,
          message?: string | null,
          log?: Json | null,
          started_at?: string | null,
          finished_at?: string | null,
          run_by?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          workflow_run_id?: string | null,
          step_id?: string | null,
          task_type?: string,
          entity_id?: string | null,
          cons_group_id?: string | null,
          version_id?: string | null,
          fiscal_year?: number | null,
          period?: number | null,
          status?: string | null,
          rows_written?: number | null,
          journal_id?: string | null,
          message?: string | null,
          log?: Json | null,
          started_at?: string | null,
          finished_at?: string | null,
          run_by?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "task_run_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "task_run_entity_id_fkey"
          columns: ["entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "task_run_journal_id_fkey"
          columns: ["journal_id"]
          isOneToOne: false
          referencedRelation: "journal_header"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "task_run_run_by_fkey"
          columns: ["run_by"]
          isOneToOne: false
          referencedRelation: "app_user"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "task_run_step_id_fkey"
          columns: ["step_id"]
          isOneToOne: false
          referencedRelation: "workflow_step"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "task_run_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "task_run_workflow_run_id_fkey"
          columns: ["workflow_run_id"]
          isOneToOne: false
          referencedRelation: "workflow_run"
          referencedColumns: ["id"]
        }
        ]
      }
      tenant: {
        Row: {
          id: string,
          name: string,
          created_at: string | null
        }
        Insert: {
          id?: string,
          name: string,
          created_at?: string | null
        }
        Update: {
          id?: string,
          name?: string,
          created_at?: string | null
        }
        Relationships: []
      }
      upload_batch: {
        Row: {
          id: string,
          tenant_id: string,
          file_name: string | null,
          storage_path: string | null,
          mapping_id: string | null,
          entity_id: string | null,
          version_id: string | null,
          fiscal_year: number | null,
          period: number | null,
          row_count: number | null,
          valid_count: number | null,
          error_count: number | null,
          status: string | null,
          journal_id: string | null,
          created_by: string | null,
          created_at: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          file_name?: string | null,
          storage_path?: string | null,
          mapping_id?: string | null,
          entity_id?: string | null,
          version_id?: string | null,
          fiscal_year?: number | null,
          period?: number | null,
          row_count?: number | null,
          valid_count?: number | null,
          error_count?: number | null,
          status?: string | null,
          journal_id?: string | null,
          created_by?: string | null,
          created_at?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          file_name?: string | null,
          storage_path?: string | null,
          mapping_id?: string | null,
          entity_id?: string | null,
          version_id?: string | null,
          fiscal_year?: number | null,
          period?: number | null,
          row_count?: number | null,
          valid_count?: number | null,
          error_count?: number | null,
          status?: string | null,
          journal_id?: string | null,
          created_by?: string | null,
          created_at?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "upload_batch_created_by_fkey"
          columns: ["created_by"]
          isOneToOne: false
          referencedRelation: "app_user"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "upload_batch_entity_id_fkey"
          columns: ["entity_id"]
          isOneToOne: false
          referencedRelation: "dim_entity"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "upload_batch_journal_id_fkey"
          columns: ["journal_id"]
          isOneToOne: false
          referencedRelation: "journal_header"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "upload_batch_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "upload_batch_version_id_fkey"
          columns: ["version_id"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        }
        ]
      }
      workflow_run: {
        Row: {
          id: string,
          tenant_id: string,
          template_id: string,
          cons_group_id: string | null,
          version_id: string,
          fiscal_year: number,
          period: number,
          status: string | null,
          started_at: string | null,
          completed_at: string | null,
          started_by: string | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          template_id: string,
          cons_group_id?: string | null,
          version_id: string,
          fiscal_year: number,
          period: number,
          status?: string | null,
          started_at?: string | null,
          completed_at?: string | null,
          started_by?: string | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          template_id?: string,
          cons_group_id?: string | null,
          version_id?: string,
          fiscal_year?: number,
          period?: number,
          status?: string | null,
          started_at?: string | null,
          completed_at?: string | null,
          started_by?: string | null
        }
        Relationships: [
        {
          foreignKeyName: "workflow_run_cons_group_id_fkey"
          columns: ["cons_group_id"]
          isOneToOne: false
          referencedRelation: "dim_cons_group"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "workflow_run_started_by_fkey"
          columns: ["started_by"]
          isOneToOne: false
          referencedRelation: "app_user"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "workflow_run_template_id_fkey"
          columns: ["template_id"]
          isOneToOne: false
          referencedRelation: "workflow_template"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "workflow_run_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "workflow_run_version_id_fkey"
          columns: ["version_id"]
          isOneToOne: false
          referencedRelation: "dim_version"
          referencedColumns: ["id"]
        }
        ]
      }
      workflow_step: {
        Row: {
          id: string,
          tenant_id: string,
          template_id: string,
          step_no: number,
          task_type: string,
          name: string,
          scope: string,
          is_blocking: boolean | null,
          requires_approval: boolean | null,
          depends_on_step_no: number[] | null,
          parameters: Json | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          template_id: string,
          step_no: number,
          task_type: string,
          name: string,
          scope?: string,
          is_blocking?: boolean | null,
          requires_approval?: boolean | null,
          depends_on_step_no?: number[] | null,
          parameters?: Json | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          template_id?: string,
          step_no?: number,
          task_type?: string,
          name?: string,
          scope?: string,
          is_blocking?: boolean | null,
          requires_approval?: boolean | null,
          depends_on_step_no?: number[] | null,
          parameters?: Json | null
        }
        Relationships: [
        {
          foreignKeyName: "workflow_step_template_id_fkey"
          columns: ["template_id"]
          isOneToOne: false
          referencedRelation: "workflow_template"
          referencedColumns: ["id"]
        },
        {
          foreignKeyName: "workflow_step_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
      workflow_template: {
        Row: {
          id: string,
          tenant_id: string,
          code: string,
          name: string,
          is_active: boolean | null
        }
        Insert: {
          id?: string,
          tenant_id: string,
          code: string,
          name: string,
          is_active?: boolean | null
        }
        Update: {
          id?: string,
          tenant_id?: string,
          code?: string,
          name?: string,
          is_active?: boolean | null
        }
        Relationships: [
        {
          foreignKeyName: "workflow_template_tenant_id_fkey"
          columns: ["tenant_id"]
          isOneToOne: false
          referencedRelation: "tenant"
          referencedColumns: ["id"]
        }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DefaultSchema = Database["public"]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? (Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      Database[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof Database },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof Database }
  ? Database[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof Database },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof Database
  }
    ? keyof Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof Database }
  ? Database[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

