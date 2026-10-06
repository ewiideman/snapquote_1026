// Types of the Machining calculator: the old SnapQuote's "Machined Parts Workbook Baseline"
// (backend-postgres/lib/machined, from "SNAPQUOTE EXCEL TEMPLATE.xlsx").

export interface MachiningMachine { name: string; ratePerHour: number; sortOrder: number }
export interface MachiningStock { partNumber: string; description: string; barLengthFeet: number; costPerBar: number; sortOrder: number }

export interface MachiningSettings {
  operatorLaborRate: number; processLaborRate: number; programmingRate: number;
  rawMaterialMarkup: number; kerfAllowanceIn: number;
  assemblyMarkup: number; assemblyShippingRate: number; outsideOperationMarkup: number; outsideOperationShippingRate: number;
  productiveHoursPerShift: number; workdaysPerWeek: number;
  partMarkingMinutesPerPart: number; bulkPackMinutesPerBox: number; separatePackMinutesPerBox: number; certificateCost: number;
  deburrCycleMinutes: number; sandblastCycleMinutes: number; cleaningCycleMinutes: number;
  aqlInspectionMinutesPerSample: number; capStudyMinutesPerUnit: number; gageRrCostPerStudy: number;
  difficulty: Record<string, number>;
  aql: { lotFrom: number[]; levels: Record<string, number[]> };
}

export type InspectionLevel = 'AQL 1.0' | 'AQL 1.5' | 'AQL 2.5' | 'AQL 4.0' | '100%' | 'NONE';

export interface MachiningInput {
  primaryMachine: string; primaryCycleSec: number | null; primarySetupHours: number | null; primaryDutyCycle: number | null; primaryLeadWeeks: number | null;
  secondaryMachine: string | null; secondaryCycleSec: number | null; secondarySetupHours: number | null; secondaryDutyCycle: number | null; secondaryLeadWeeks: number | null;
  operatingShifts: number | null;
  deburr: boolean; partsPerDeburrCycle: number | null;
  sandblast: boolean; partsPerSandblastCycle: number | null;
  cleaning: boolean; partsPerCleaningCycle: number | null;
  partMarking: boolean;
  packaging: 'BULK' | 'SEPARATE' | 'NONE'; partsPerBox: number | null; costPerBox: number | null;
  perishableToolingPct: number | null;
  programmingHours: number | null; programmingAmortized: boolean; programmingLeadWeeks: number | null;
  material: { mode: 'STOCKED'; partNumber: string; rawLengthIn: number | null; remnantIn: number | null } | { mode: 'CUSTOM'; unitPrice: number | null; stockLengthIn: number | null; rawLengthIn: number | null; remnantIn: number | null };
  workholding: { cost: number | null; amortized: boolean; leadWeeks: number | null };
  tooling: { cost: number | null; amortized: boolean; leadWeeks: number | null };
  gaging: { cost: number | null; amortized: boolean; leadWeeks: number | null };
  inspectionLevel: InspectionLevel; inspectionDifficulty: 'A' | 'B' | 'C' | 'D';
  fai: { required: boolean; parts: number | null; leadWeeks: number | null };
  capStudy: { required: boolean; featuresXParts: number | null; leadWeeks: number | null };
  gageRr: { required: boolean; studies: number | null; leadWeeks: number | null };
  coc: boolean;
  assemblyOps: { label: string; costEach: number | null; ship: boolean; leadWeeks: number | null }[];
  outsideOps: { label: string; costEach: number | null; lotCharge: number | null; leadWeeks: number | null }[];
}

/** Every line of the workbook for one quantity, named as the old engine named it. */
export type MachiningBreak = { quantity: number } & Record<string, number>;

export interface MachiningResult { breaks: MachiningBreak[]; nreCost: number; leadWeeks: number; warnings: string[] }
