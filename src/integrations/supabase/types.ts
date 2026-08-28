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
          id: string
          tenant_id: string
          email: string
          role: string
          created_at: string | null
        }
        Insert: {
          id: string
          tenant_id: string
          email: string
          role?: string
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          email?: string
          role?: string
          created_at?: string | null
        }
        Relationships: []
      }
      cons_group_member: {
        Row: {
          id: string
          tenant_id: string
          cons_group_id: string
          entity_id: string
          cons_method: string
          direct_ownership_pct: number
          group_share_pct: number
          minority_pct: number | null
          first_cons_year: number | null
          first_cons_period: number | null
          last_cons_year: number | null
          last_cons_period: number | null
        }
        Insert: {
          id?: string
          tenant_id: string
          cons_group_id: string
          entity_id: string
          cons_method: string
          direct_ownership_pct?: number
          group_share_pct?: number
          first_cons_year?: number | null
          first_cons_period?: number | null
          last_cons_year?: number | null
          last_cons_period?: number | null
        }
        Update: {
          id?: string
          tenant_id?: string
          cons_group_id?: string
          entity_id?: string
          cons_method?: string
          direct_ownership_pct?: number
          group_share_pct?: number
          first_cons_year?: number | null
          first_cons_period?: number | null
          last_cons_year?: number | null
          last_cons_period?: number | null
        }
        Relationships: []
      }
      dim_account: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          statement_type: string
          account_class: string
          normal_balance: string
          requires_partner: boolean | null
          requires_movement: boolean | null
          is_intercompany: boolean | null
          elimination_group: string | null
          translation_method: string | null
          is_investment_account: boolean | null
          is_equity_account: boolean | null
          is_retained_earnings: boolean | null
          is_net_income: boolean | null
          is_active: boolean | null
          attributes: Json | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          statement_type: string
          account_class: string
          normal_balance: string
          requires_partner?: boolean | null
          requires_movement?: boolean | null
          is_intercompany?: boolean | null
          elimination_group?: string | null
          translation_method?: string | null
          is_investment_account?: boolean | null
          is_equity_account?: boolean | null
          is_retained_earnings?: boolean | null
          is_net_income?: boolean | null
          is_active?: boolean | null
          attributes?: Json | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          statement_type?: string
          account_class?: string
          normal_balance?: string
          requires_partner?: boolean | null
          requires_movement?: boolean | null
          is_intercompany?: boolean | null
          elimination_group?: string | null
          translation_method?: string | null
          is_investment_account?: boolean | null
          is_equity_account?: boolean | null
          is_retained_earnings?: boolean | null
          is_net_income?: boolean | null
          is_active?: boolean | null
          attributes?: Json | null
        }
        Relationships: []
      }
      dim_cons_group: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          group_currency: string
          parent_group_id: string | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          group_currency: string
          parent_group_id?: string | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          group_currency?: string
          parent_group_id?: string | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      dim_currency: {
        Row: {
          code: string
          name: string
          decimals: number | null
        }
        Insert: {
          code: string
          name: string
          decimals?: number | null
        }
        Update: {
          code?: string
          name?: string
          decimals?: number | null
        }
        Relationships: []
      }
      dim_entity: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          local_currency: string
          country: string | null
          entity_type: string | null
          default_cons_method: string | null
          acquisition_date: string | null
          divestment_date: string | null
          is_active: boolean | null
          attributes: Json | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          local_currency: string
          country?: string | null
          entity_type?: string | null
          default_cons_method?: string | null
          acquisition_date?: string | null
          divestment_date?: string | null
          is_active?: boolean | null
          attributes?: Json | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          local_currency?: string
          country?: string | null
          entity_type?: string | null
          default_cons_method?: string | null
          acquisition_date?: string | null
          divestment_date?: string | null
          is_active?: boolean | null
          attributes?: Json | null
        }
        Relationships: []
      }
      dim_generic_member: {
        Row: {
          id: string
          tenant_id: string
          dim_code: string
          code: string
          name: string
          parent_code: string | null
          is_active: boolean | null
          attributes: Json | null
        }
        Insert: {
          id?: string
          tenant_id: string
          dim_code: string
          code: string
          name: string
          parent_code?: string | null
          is_active?: boolean | null
          attributes?: Json | null
        }
        Update: {
          id?: string
          tenant_id?: string
          dim_code?: string
          code?: string
          name?: string
          parent_code?: string | null
          is_active?: boolean | null
          attributes?: Json | null
        }
        Relationships: []
      }
      dim_hierarchy: {
        Row: {
          id: string
          tenant_id: string
          dim_code: string
          hierarchy_code: string
          hierarchy_name: string
        }
        Insert: {
          id?: string
          tenant_id: string
          dim_code: string
          hierarchy_code: string
          hierarchy_name: string
        }
        Update: {
          id?: string
          tenant_id?: string
          dim_code?: string
          hierarchy_code?: string
          hierarchy_name?: string
        }
        Relationships: []
      }
      dim_hierarchy_node: {
        Row: {
          id: string
          tenant_id: string
          hierarchy_id: string
          member_code: string
          parent_member_code: string | null
          node_order: number | null
          aggregation_sign: number | null
        }
        Insert: {
          id?: string
          tenant_id: string
          hierarchy_id: string
          member_code: string
          parent_member_code?: string | null
          node_order?: number | null
          aggregation_sign?: number | null
        }
        Update: {
          id?: string
          tenant_id?: string
          hierarchy_id?: string
          member_code?: string
          parent_member_code?: string | null
          node_order?: number | null
          aggregation_sign?: number | null
        }
        Relationships: []
      }
      dim_movement: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          movement_class: string
          is_bcf_target: boolean | null
          is_bcf_source: boolean | null
          cash_flow_relevant: boolean | null
          display_order: number | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          movement_class: string
          is_bcf_target?: boolean | null
          is_bcf_source?: boolean | null
          cash_flow_relevant?: boolean | null
          display_order?: number | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          movement_class?: string
          is_bcf_target?: boolean | null
          is_bcf_source?: boolean | null
          cash_flow_relevant?: boolean | null
          display_order?: number | null
        }
        Relationships: []
      }
      dim_registry: {
        Row: {
          id: string
          tenant_id: string
          dim_code: string
          dim_name: string
          is_mandatory: boolean
          is_active: boolean
          physical_column: string
          master_table: string | null
          is_hierarchical: boolean | null
          requires_partner: boolean | null
          display_order: number | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          dim_code: string
          dim_name: string
          is_mandatory?: boolean
          is_active?: boolean
          physical_column: string
          master_table?: string | null
          is_hierarchical?: boolean | null
          requires_partner?: boolean | null
          display_order?: number | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          dim_code?: string
          dim_name?: string
          is_mandatory?: boolean
          is_active?: boolean
          physical_column?: string
          master_table?: string | null
          is_hierarchical?: boolean | null
          requires_partner?: boolean | null
          display_order?: number | null
          created_at?: string | null
        }
        Relationships: []
      }
      dim_version: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          version_type: string | null
          is_locked: boolean | null
          copy_source_version: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          version_type?: string | null
          is_locked?: boolean | null
          copy_source_version?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          version_type?: string | null
          is_locked?: boolean | null
          copy_source_version?: string | null
        }
        Relationships: []
      }
      fact_balances: {
        Row: {
          id: number
          tenant_id: string
          entity_id: string
          account_id: string
          movement_id: string | null
          partner_id: string | null
          cons_group_id: string | null
          version_id: string
          fiscal_year: number
          period: number
          posting_level: string
          zdim01: string | null
          zdim02: string | null
          zdim03: string | null
          zdim04: string | null
          zdim05: string | null
          zdim06: string | null
          zdim07: string | null
          zdim08: string | null
          zdim09: string | null
          zdim10: string | null
          transaction_currency: string | null
          local_currency: string
          group_currency: string
          amount_tc: number | null
          amount_lc: number
          amount_gc: number
          quantity: number | null
          journal_id: string | null
          task_run_id: string | null
          source_task: string
          created_at: string | null
        }
        Insert: {
          id?: number
          tenant_id: string
          entity_id: string
          account_id: string
          movement_id?: string | null
          partner_id?: string | null
          cons_group_id?: string | null
          version_id: string
          fiscal_year: number
          period: number
          posting_level?: string
          zdim01?: string | null
          zdim02?: string | null
          zdim03?: string | null
          zdim04?: string | null
          zdim05?: string | null
          zdim06?: string | null
          zdim07?: string | null
          zdim08?: string | null
          zdim09?: string | null
          zdim10?: string | null
          transaction_currency?: string | null
          local_currency: string
          group_currency: string
          amount_tc?: number | null
          amount_lc?: number
          amount_gc?: number
          quantity?: number | null
          journal_id?: string | null
          task_run_id?: string | null
          source_task?: string
          created_at?: string | null
        }
        Update: {
          id?: number
          tenant_id?: string
          entity_id?: string
          account_id?: string
          movement_id?: string | null
          partner_id?: string | null
          cons_group_id?: string | null
          version_id?: string
          fiscal_year?: number
          period?: number
          posting_level?: string
          zdim01?: string | null
          zdim02?: string | null
          zdim03?: string | null
          zdim04?: string | null
          zdim05?: string | null
          zdim06?: string | null
          zdim07?: string | null
          zdim08?: string | null
          zdim09?: string | null
          zdim10?: string | null
          transaction_currency?: string | null
          local_currency?: string
          group_currency?: string
          amount_tc?: number | null
          amount_lc?: number
          amount_gc?: number
          quantity?: number | null
          journal_id?: string | null
          task_run_id?: string | null
          source_task?: string
          created_at?: string | null
        }
        Relationships: []
      }
      fx_rate: {
        Row: {
          id: string
          tenant_id: string
          rate_type: string
          from_currency: string
          to_currency: string
          fiscal_year: number
          period: number
          rate: number
          version_id: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          rate_type: string
          from_currency: string
          to_currency: string
          fiscal_year: number
          period: number
          rate: number
          version_id?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          rate_type?: string
          from_currency?: string
          to_currency?: string
          fiscal_year?: number
          period?: number
          rate?: number
          version_id?: string | null
        }
        Relationships: []
      }
      historical_rate: {
        Row: {
          id: string
          tenant_id: string
          entity_id: string
          account_id: string
          movement_id: string | null
          rate: number
          valid_from_year: number | null
          valid_from_period: number | null
        }
        Insert: {
          id?: string
          tenant_id: string
          entity_id: string
          account_id: string
          movement_id?: string | null
          rate: number
          valid_from_year?: number | null
          valid_from_period?: number | null
        }
        Update: {
          id?: string
          tenant_id?: string
          entity_id?: string
          account_id?: string
          movement_id?: string | null
          rate?: number
          valid_from_year?: number | null
          valid_from_period?: number | null
        }
        Relationships: []
      }
      ic_reconciliation: {
        Row: {
          id: number
          tenant_id: string
          task_run_id: string | null
          cons_group_id: string | null
          fiscal_year: number | null
          period: number | null
          version_id: string | null
          entity_id: string | null
          partner_id: string | null
          rule_id: string | null
          leg1_amount_gc: number | null
          leg2_amount_gc: number | null
          difference_gc: number | null
          status: string | null
        }
        Insert: {
          id?: number
          tenant_id: string
          task_run_id?: string | null
          cons_group_id?: string | null
          fiscal_year?: number | null
          period?: number | null
          version_id?: string | null
          entity_id?: string | null
          partner_id?: string | null
          rule_id?: string | null
          leg1_amount_gc?: number | null
          leg2_amount_gc?: number | null
          difference_gc?: number | null
          status?: string | null
        }
        Update: {
          id?: number
          tenant_id?: string
          task_run_id?: string | null
          cons_group_id?: string | null
          fiscal_year?: number | null
          period?: number | null
          version_id?: string | null
          entity_id?: string | null
          partner_id?: string | null
          rule_id?: string | null
          leg1_amount_gc?: number | null
          leg2_amount_gc?: number | null
          difference_gc?: number | null
          status?: string | null
        }
        Relationships: []
      }
      investment_register: {
        Row: {
          id: string
          tenant_id: string
          cons_group_id: string
          investor_entity_id: string
          investee_entity_id: string
          activity: string
          fiscal_year: number
          period: number
          cons_method: string
          ownership_pct_before: number | null
          ownership_pct_after: number
          investment_cost_gc: number | null
          fair_value_adjustment_gc: number | null
          net_assets_acquired_gc: number | null
          goodwill_gc: number | null
          nci_measurement: string | null
          is_posted: boolean | null
          notes: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          cons_group_id: string
          investor_entity_id: string
          investee_entity_id: string
          activity: string
          fiscal_year: number
          period: number
          cons_method: string
          ownership_pct_before?: number | null
          ownership_pct_after: number
          investment_cost_gc?: number | null
          fair_value_adjustment_gc?: number | null
          net_assets_acquired_gc?: number | null
          goodwill_gc?: number | null
          nci_measurement?: string | null
          is_posted?: boolean | null
          notes?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          cons_group_id?: string
          investor_entity_id?: string
          investee_entity_id?: string
          activity?: string
          fiscal_year?: number
          period?: number
          cons_method?: string
          ownership_pct_before?: number | null
          ownership_pct_after?: number
          investment_cost_gc?: number | null
          fair_value_adjustment_gc?: number | null
          net_assets_acquired_gc?: number | null
          goodwill_gc?: number | null
          nci_measurement?: string | null
          is_posted?: boolean | null
          notes?: string | null
        }
        Relationships: []
      }
      journal_header: {
        Row: {
          id: string
          tenant_id: string
          doc_number: number
          doc_type: string
          posting_level: string
          fiscal_year: number
          period: number
          version_id: string
          cons_group_id: string | null
          task_run_id: string | null
          description: string | null
          is_reversed: boolean | null
          reversed_by: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          doc_number?: number
          doc_type: string
          posting_level: string
          fiscal_year: number
          period: number
          version_id: string
          cons_group_id?: string | null
          task_run_id?: string | null
          description?: string | null
          is_reversed?: boolean | null
          reversed_by?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          doc_number?: number
          doc_type?: string
          posting_level?: string
          fiscal_year?: number
          period?: number
          version_id?: string
          cons_group_id?: string | null
          task_run_id?: string | null
          description?: string | null
          is_reversed?: boolean | null
          reversed_by?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      period_status: {
        Row: {
          id: string
          tenant_id: string
          fiscal_year: number
          period: number
          version_id: string
          cons_group_id: string | null
          status: string
        }
        Insert: {
          id?: string
          tenant_id: string
          fiscal_year: number
          period: number
          version_id: string
          cons_group_id?: string | null
          status?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          fiscal_year?: number
          period?: number
          version_id?: string
          cons_group_id?: string | null
          status?: string
        }
        Relationships: []
      }
      rule_bcf: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          source_account_filter: Json | null
          source_movement_class: string[] | null
          target_movement_code: string
          carry_partner: boolean | null
          carry_custom_dims: boolean | null
          pl_to_retained_earnings: boolean | null
          retained_earnings_account_code: string | null
          sequence: number | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          source_account_filter?: Json | null
          source_movement_class?: string[] | null
          target_movement_code: string
          carry_partner?: boolean | null
          carry_custom_dims?: boolean | null
          pl_to_retained_earnings?: boolean | null
          retained_earnings_account_code?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          source_account_filter?: Json | null
          source_movement_class?: string[] | null
          target_movement_code?: string
          carry_partner?: boolean | null
          carry_custom_dims?: boolean | null
          pl_to_retained_earnings?: boolean | null
          retained_earnings_account_code?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      rule_coi: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          cons_method: string
          investment_account_code: string
          equity_account_filter: Json
          goodwill_account_code: string | null
          badwill_account_code: string | null
          nci_equity_account_code: string | null
          nci_pl_account_code: string | null
          equity_pickup_account_code: string | null
          equity_income_account_code: string | null
          goodwill_amortisation_account_code: string | null
          posting_level: string | null
          sequence: number | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          cons_method: string
          investment_account_code: string
          equity_account_filter: Json
          goodwill_account_code?: string | null
          badwill_account_code?: string | null
          nci_equity_account_code?: string | null
          nci_pl_account_code?: string | null
          equity_pickup_account_code?: string | null
          equity_income_account_code?: string | null
          goodwill_amortisation_account_code?: string | null
          posting_level?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          cons_method?: string
          investment_account_code?: string
          equity_account_filter?: Json
          goodwill_account_code?: string | null
          badwill_account_code?: string | null
          nci_equity_account_code?: string | null
          nci_pl_account_code?: string | null
          equity_pickup_account_code?: string | null
          equity_income_account_code?: string | null
          goodwill_amortisation_account_code?: string | null
          posting_level?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      rule_ic_elim: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          elimination_group: string
          leg1_account_filter: Json
          leg2_account_filter: Json
          match_on: string[] | null
          is_two_sided: boolean | null
          difference_threshold_abs: number | null
          difference_threshold_pct: number | null
          currency_diff_account_code: string | null
          real_diff_account_code: string | null
          posting_level: string | null
          post_in_currency: string | null
          sequence: number | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          elimination_group: string
          leg1_account_filter: Json
          leg2_account_filter: Json
          match_on?: string[] | null
          is_two_sided?: boolean | null
          difference_threshold_abs?: number | null
          difference_threshold_pct?: number | null
          currency_diff_account_code?: string | null
          real_diff_account_code?: string | null
          posting_level?: string | null
          post_in_currency?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          elimination_group?: string
          leg1_account_filter?: Json
          leg2_account_filter?: Json
          match_on?: string[] | null
          is_two_sided?: boolean | null
          difference_threshold_abs?: number | null
          difference_threshold_pct?: number | null
          currency_diff_account_code?: string | null
          real_diff_account_code?: string | null
          posting_level?: string | null
          post_in_currency?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      rule_net_income: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          source_account_filter: Json | null
          target_bs_account_code: string
          target_movement_code: string | null
          split_to_minority: boolean | null
          minority_account_code: string | null
          sequence: number | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          source_account_filter?: Json | null
          target_bs_account_code: string
          target_movement_code?: string | null
          split_to_minority?: boolean | null
          minority_account_code?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          source_account_filter?: Json | null
          target_bs_account_code?: string
          target_movement_code?: string | null
          split_to_minority?: boolean | null
          minority_account_code?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      rule_translation: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          account_filter: Json | null
          rate_type: string
          historical_rate_source: string | null
          post_difference_to: string | null
          difference_scope: string | null
          sequence: number | null
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          account_filter?: Json | null
          rate_type: string
          historical_rate_source?: string | null
          post_difference_to?: string | null
          difference_scope?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          account_filter?: Json | null
          rate_type?: string
          historical_rate_source?: string | null
          post_difference_to?: string | null
          difference_scope?: string | null
          sequence?: number | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      stg_upload: {
        Row: {
          id: number
          tenant_id: string
          batch_id: string
          row_no: number
          raw: Json
          entity_code: string | null
          account_code: string | null
          movement_code: string | null
          partner_code: string | null
          zdim01: string | null
          zdim02: string | null
          zdim03: string | null
          zdim04: string | null
          zdim05: string | null
          zdim06: string | null
          zdim07: string | null
          zdim08: string | null
          zdim09: string | null
          zdim10: string | null
          amount_lc: number | null
          amount_tc: number | null
          transaction_currency: string | null
          status: string | null
          error_msg: string | null
        }
        Insert: {
          id?: number
          tenant_id: string
          batch_id: string
          row_no: number
          raw: Json
          entity_code?: string | null
          account_code?: string | null
          movement_code?: string | null
          partner_code?: string | null
          zdim01?: string | null
          zdim02?: string | null
          zdim03?: string | null
          zdim04?: string | null
          zdim05?: string | null
          zdim06?: string | null
          zdim07?: string | null
          zdim08?: string | null
          zdim09?: string | null
          zdim10?: string | null
          amount_lc?: number | null
          amount_tc?: number | null
          transaction_currency?: string | null
          status?: string | null
          error_msg?: string | null
        }
        Update: {
          id?: number
          tenant_id?: string
          batch_id?: string
          row_no?: number
          raw?: Json
          entity_code?: string | null
          account_code?: string | null
          movement_code?: string | null
          partner_code?: string | null
          zdim01?: string | null
          zdim02?: string | null
          zdim03?: string | null
          zdim04?: string | null
          zdim05?: string | null
          zdim06?: string | null
          zdim07?: string | null
          zdim08?: string | null
          zdim09?: string | null
          zdim10?: string | null
          amount_lc?: number | null
          amount_tc?: number | null
          transaction_currency?: string | null
          status?: string | null
          error_msg?: string | null
        }
        Relationships: []
      }
      task_run: {
        Row: {
          id: string
          tenant_id: string
          workflow_run_id: string | null
          step_id: string | null
          task_type: string
          entity_id: string | null
          cons_group_id: string | null
          version_id: string | null
          fiscal_year: number | null
          period: number | null
          status: string | null
          rows_written: number | null
          journal_id: string | null
          message: string | null
          log: Json | null
          started_at: string | null
          finished_at: string | null
          run_by: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          workflow_run_id?: string | null
          step_id?: string | null
          task_type: string
          entity_id?: string | null
          cons_group_id?: string | null
          version_id?: string | null
          fiscal_year?: number | null
          period?: number | null
          status?: string | null
          rows_written?: number | null
          journal_id?: string | null
          message?: string | null
          log?: Json | null
          started_at?: string | null
          finished_at?: string | null
          run_by?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          workflow_run_id?: string | null
          step_id?: string | null
          task_type?: string
          entity_id?: string | null
          cons_group_id?: string | null
          version_id?: string | null
          fiscal_year?: number | null
          period?: number | null
          status?: string | null
          rows_written?: number | null
          journal_id?: string | null
          message?: string | null
          log?: Json | null
          started_at?: string | null
          finished_at?: string | null
          run_by?: string | null
        }
        Relationships: []
      }
      tenant: {
        Row: {
          id: string
          name: string
          created_at: string | null
        }
        Insert: {
          id?: string
          name: string
          created_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          created_at?: string | null
        }
        Relationships: []
      }
      upload_batch: {
        Row: {
          id: string
          tenant_id: string
          file_name: string | null
          storage_path: string | null
          mapping_id: string | null
          entity_id: string | null
          version_id: string | null
          fiscal_year: number | null
          period: number | null
          row_count: number | null
          valid_count: number | null
          error_count: number | null
          status: string | null
          journal_id: string | null
          created_by: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          file_name?: string | null
          storage_path?: string | null
          mapping_id?: string | null
          entity_id?: string | null
          version_id?: string | null
          fiscal_year?: number | null
          period?: number | null
          row_count?: number | null
          valid_count?: number | null
          error_count?: number | null
          status?: string | null
          journal_id?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          file_name?: string | null
          storage_path?: string | null
          mapping_id?: string | null
          entity_id?: string | null
          version_id?: string | null
          fiscal_year?: number | null
          period?: number | null
          row_count?: number | null
          valid_count?: number | null
          error_count?: number | null
          status?: string | null
          journal_id?: string | null
          created_by?: string | null
          created_at?: string | null
        }
        Relationships: []
      }
      upload_mapping: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          column_map: Json
          value_map: Json
          default_values: Json
          created_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          column_map?: Json
          value_map?: Json
          default_values?: Json
          created_at?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          column_map?: Json
          value_map?: Json
          default_values?: Json
          created_at?: string | null
        }
        Relationships: []
      }
      workflow_run: {
        Row: {
          id: string
          tenant_id: string
          template_id: string
          cons_group_id: string | null
          version_id: string
          fiscal_year: number
          period: number
          status: string | null
          started_at: string | null
          completed_at: string | null
          started_by: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          template_id: string
          cons_group_id?: string | null
          version_id: string
          fiscal_year: number
          period: number
          status?: string | null
          started_at?: string | null
          completed_at?: string | null
          started_by?: string | null
        }
        Update: {
          id?: string
          tenant_id?: string
          template_id?: string
          cons_group_id?: string | null
          version_id?: string
          fiscal_year?: number
          period?: number
          status?: string | null
          started_at?: string | null
          completed_at?: string | null
          started_by?: string | null
        }
        Relationships: []
      }
      workflow_step: {
        Row: {
          id: string
          tenant_id: string
          template_id: string
          step_no: number
          task_type: string
          name: string
          scope: string
          is_blocking: boolean | null
          requires_approval: boolean | null
          depends_on_step_no: number[] | null
          parameters: Json | null
        }
        Insert: {
          id?: string
          tenant_id: string
          template_id: string
          step_no: number
          task_type: string
          name: string
          scope?: string
          is_blocking?: boolean | null
          requires_approval?: boolean | null
          depends_on_step_no?: number[] | null
          parameters?: Json | null
        }
        Update: {
          id?: string
          tenant_id?: string
          template_id?: string
          step_no?: number
          task_type?: string
          name?: string
          scope?: string
          is_blocking?: boolean | null
          requires_approval?: boolean | null
          depends_on_step_no?: number[] | null
          parameters?: Json | null
        }
        Relationships: []
      }
      workflow_template: {
        Row: {
          id: string
          tenant_id: string
          code: string
          name: string
          is_active: boolean | null
        }
        Insert: {
          id?: string
          tenant_id: string
          code: string
          name: string
          is_active?: boolean | null
        }
        Update: {
          id?: string
          tenant_id?: string
          code?: string
          name?: string
          is_active?: boolean | null
        }
        Relationships: []
      }
    }
    Views: {
      v_fact_browser: {
        Row: {
          id: number | null
          tenant_id: string | null
          journal_id: string | null
          task_run_id: string | null
          source_task: string | null
          created_at: string | null
          posting_level: string | null
          fiscal_year: number | null
          period: number | null
          version_id: string | null
          version_code: string | null
          entity_code: string | null
          entity_name: string | null
          account_code: string | null
          account_name: string | null
          movement_code: string | null
          movement_name: string | null
          partner_code: string | null
          partner_name: string | null
          cons_group_id: string | null
          cons_group_code: string | null
          zdim01: string | null
          zdim02: string | null
          zdim03: string | null
          zdim04: string | null
          zdim05: string | null
          zdim06: string | null
          zdim07: string | null
          zdim08: string | null
          zdim09: string | null
          zdim10: string | null
          transaction_currency: string | null
          local_currency: string | null
          group_currency: string | null
          amount_tc: number | null
          amount_lc: number | null
          amount_gc: number | null
          quantity: number | null
        }
        Relationships: []
      }
      v_hierarchy_flat: {
        Row: {
          hierarchy_id: string | null
          ancestor_code: string | null
          descendant_code: string | null
          depth: number | null
          sign: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_data_model: {
        Args: {
          p_dimensions: Json
        }
        Returns: Json
      }
      assert_period_open: {
        Args: {
          p_tenant: string
          p_version: string
          p_year: number
          p_period: number
          p_cons_group: string
        }
        Returns: undefined
      }
      current_tenant_id: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
      match_account_condition: {
        Args: {
          a: string
          c: Json
        }
        Returns: boolean
      }
      post_manual_journal: {
        Args: {
          p_header: Json
          p_lines: Json
        }
        Returns: Json
      }
      post_upload_batch: {
        Args: {
          p_batch_id: string
          p_valid_only?: boolean
        }
        Returns: Json
      }
      resolve_account_filter: {
        Args: {
          p_tenant: string
          p_filter: Json
        }
        Returns: {
            account_id: string
          }[]
      }
      reverse_journal: {
        Args: {
          p_journal_id: string
        }
        Returns: Json
      }
      reverse_task_run: {
        Args: {
          p_task_run_id: string
        }
        Returns: Json
      }
      reverse_upload_batch: {
        Args: {
          p_batch_id: string
        }
        Returns: Json
      }
      run_bcf: {
        Args: {
          p_version: string
          p_year: number
          p_entities?: string[]
          p_groups?: string[]
        }
        Returns: {
            task_run_id: string
            target_kind: string
            target_id: string
            target_code: string
            target_name: string
            rows_written: number
            status: string
            message: string
          }[]
      }
      run_bcf_entity: {
        Args: {
          p_task_run_id: string
          p_tenant: string
          p_version: string
          p_entity: string
          p_year: number
        }
        Returns: number
      }
      run_bcf_group: {
        Args: {
          p_task_run_id: string
          p_tenant: string
          p_version: string
          p_cons_group: string
          p_year: number
        }
        Returns: number
      }
      validate_upload_batch: {
        Args: {
          p_batch_id: string
        }
        Returns: Json
      }
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

