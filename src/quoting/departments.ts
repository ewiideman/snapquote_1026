// The departments a quote can ask for prices. Molding prices through ADC, the advanced development
// center, which is where Molding gets its quoting information; the screens call it "Molding (ADC)".
export const DEPARTMENTS = [
  { key: 'metals', name: 'Metals' },
  { key: 'procurement', name: 'Procurement' },
  { key: 'molding', name: 'Molding (ADC)' },
  { key: 'machining', name: 'Machining' },
  { key: 'assembly', name: 'Assembly' },
] as const;

export type DepartmentKey = (typeof DEPARTMENTS)[number]['key'];

export const isDepartment = (v: unknown): v is DepartmentKey => typeof v === 'string' && DEPARTMENTS.some((d) => d.key === v);

export const departmentName = (key: string): string => DEPARTMENTS.find((d) => d.key === key)?.name ?? key;
