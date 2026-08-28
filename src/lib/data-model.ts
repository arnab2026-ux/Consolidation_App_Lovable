export interface MandatoryDimension {
  code: string;
  name: string;
  physicalColumn: string;
  description: string;
}

/** Fixed dimensions of the consolidation model. Always present, never optional. */
export const MANDATORY_DIMENSIONS: MandatoryDimension[] = [
  {
    code: "ENTITY",
    name: "Entity",
    physicalColumn: "entity_id",
    description: "Reporting unit / legal entity that owns the balance.",
  },
  {
    code: "ACCOUNT",
    name: "Account",
    physicalColumn: "account_id",
    description: "Group chart of accounts item.",
  },
  {
    code: "MOVEMENT",
    name: "Movement Type",
    physicalColumn: "movement_id",
    description: "Flow / movement analysis of the balance change.",
  },
  {
    code: "PARTNER",
    name: "Partner",
    physicalColumn: "partner_id",
    description: "Counterparty entity, required for intercompany matching.",
  },
  {
    code: "CONS_GROUP",
    name: "Consolidation Group",
    physicalColumn: "cons_group_id",
    description: "Group / sub-group for which the data is consolidated.",
  },
  {
    code: "VERSION",
    name: "Version",
    physicalColumn: "version_id",
    description: "Actual, budget, forecast or restatement scenario.",
  },
  {
    code: "PERIOD",
    name: "Period (Year / Period)",
    physicalColumn: "fiscal_year + period",
    description: "Fiscal year and posting period of the balance.",
  },
  {
    code: "POSTING_LEVEL",
    name: "Posting Level",
    physicalColumn: "posting_level",
    description: "Origin of the record: reported, adjustment or elimination.",
  },
];

export interface DimensionTemplate {
  code: string;
  name: string;
  description: string;
}

/** Catalogue of pre-defined optional dimensions. */
export const DIMENSION_TEMPLATES: DimensionTemplate[] = [
  { code: "PROFIT_CENTER", name: "Profit Center", description: "Internal responsibility unit for margin reporting." },
  { code: "COST_CENTER", name: "Cost Center", description: "Cost collector for expense analysis." },
  { code: "SEGMENT", name: "Segment", description: "Operating segment for IFRS 8 disclosures." },
  { code: "PRODUCT", name: "Product", description: "Product or product family." },
  { code: "CUSTOMER_GROUP", name: "Customer Group", description: "Customer classification for revenue splits." },
  { code: "PROJECT", name: "Project", description: "Project or WBS element." },
  { code: "FUNCTIONAL_AREA", name: "Functional Area", description: "Cost-of-sales method functional split." },
  {
    code: "TRADING_PARTNER_GROUP",
    name: "Trading Partner Group",
    description: "Grouping of counterparties for IC analysis.",
  },
  { code: "CHANNEL", name: "Channel", description: "Sales or distribution channel." },
  { code: "LEGAL_BASIS", name: "Legal Basis", description: "Reporting basis such as local GAAP or IFRS." },
];

export const MAX_OPTIONAL_DIMENSIONS = 10;

export interface DimensionSelection {
  code: string;
  name: string;
}

export function normalizeDimensionCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
