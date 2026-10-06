// Shapes the API returns (see src/persistence). Kept here so the UI does not import server code.
export type DepartmentKey = 'metals' | 'procurement' | 'molding' | 'machining' | 'assembly';
export type Role = 'sales' | 'estimator' | 'manager' | 'administrator';
export type Stage = 'draft' | 'estimating' | 'ready' | 'sent' | 'won' | 'lost' | 'no_bid';
export type RequestStatus = 'open' | 'question' | 'answered' | 'withdrawn';

export interface Account { id: string; displayName: string; role: Role; department: DepartmentKey | null; email: string | null; emailNotifications: boolean; mustChangePassword: boolean }
export interface Department { key: DepartmentKey; name: string }
export interface Person { id: string; displayName: string; role: Role; department: DepartmentKey | null }

export interface BoardCard {
  id: number; number: string; revision: number; customerName: string | null; title: string; ownerId: string; ownerName: string; stage: Stage;
  customerDueOn: string | null; itar: boolean; lineCount: number; departments: DepartmentKey[]; waitingOn: DepartmentKey[]; questionsFrom: DepartmentKey[];
  neededBy: string | null; firstQuantity: number | null; firstTotal: number | null; awardAmount: number | null; updatedAt: string; closedAt: string | null;
}

export interface QueueItem {
  requestId: number; quoteId: number; number: string; customerName: string | null; title: string; ownerName: string; status: RequestStatus;
  neededBy: string | null; customerDueOn: string | null; assigneeName: string | null; lines: number; priced: number; sentAt: string; itar: boolean;
}

export interface Estimate {
  id: number; department: DepartmentKey; basis: 'calculator' | 'vendor_quote' | 'manual'; prices: { quantity: number; unitPrice: number }[];
  oneTimeCost: number; oneTimeLabel: string; leadTimeWeeks: number | null; notes: string; inputs: any; detail: any; enteredBy: string; enteredByName: string; enteredAt: string;
}

export interface Line {
  id: number; position: number; partNumber: string; revision: string; description: string; qtyPer: number; quantities: number[];
  department: DepartmentKey | null; notes: string; pieceQuantities: number[]; estimate: Estimate | null;
}

export interface Request { id: number; department: DepartmentKey; status: RequestStatus; assigneeId: string | null; assigneeName: string | null; neededBy: string | null; sentAt: string; answeredAt: string | null; answeredByName: string | null }
export interface Attachment { id: number; lineId: number | null; fileName: string; contentType: string; sizeBytes: number; source: 'upload' | 'email'; uploadedByName: string; uploadedAt: string }
export interface Message { id: number; department: string | null; authorName: string; kind: 'note' | 'question' | 'answer' | 'event'; body: string; at: string }

export interface SheetCell { quantity: number; estimated: number | null; override: number | null; overrideReason: string | null; unitPrice: number | null; extended: number | null }
export interface Sheet {
  lines: { lineId: number; cells: SheetCell[]; oneTimeCost: number; oneTimeLabel: string; leadTimeWeeks: number | null }[];
  assembly: { quantity: number; unitPrice: number | null; extended: number | null }[] | null;
  oneTimeTotal: number; leadTimeWeeks: number | null; complete: boolean; missing: { lineId: number; quantities: number[] }[];
}

export interface QuoteHeader {
  id: number; number: string; revision: number; customerId: number | null; customerName: string | null; title: string; contactName: string | null; contactEmail: string | null;
  rfqReceivedOn: string | null; customerDueOn: string | null; ownerId: string; ownerName: string; quantities: number[]; itar: boolean; notes: string;
  status: 'draft' | 'estimating' | 'sent' | 'won' | 'lost' | 'no_bid'; sourceEmail: { subject: string; from: string; date: string | null } | null;
  sentAt: string | null; closedAt: string | null; closeReason: string | null; poNumber: string | null; awardAmount: number | null; orderedQuantity: number | null; createdAt: string; updatedAt: string;
  deletedAt: string | null; deletedByName: string | null; deleteReason: string | null;
}

export interface QuoteDetail {
  quote: QuoteHeader; stage: Stage; lines: Line[]; requests: Request[]; attachments: Attachment[]; messages: Message[];
  overrides: { lineId: number; quantity: number; unitPrice: number; reason: string; setByName: string; setAt: string }[];
  sheet: Sheet; lostReasons: string[];
}

export interface DropResult {
  attachments: { id: number; fileName: string }[];
  linesAdded: { fileName: string; sheet: string | null; lineIds: number[]; alreadyOnQuote: number }[];
  notRead: { fileName: string; problem: string }[];
  fromEmail: { subject: string; from: string; date: string | null; customerName: string | null } | null;
}

export const STAGE_NAMES: Record<Stage, string> = {
  draft: 'Drafting', estimating: 'With the departments', ready: 'Ready to send', sent: 'With the customer', won: 'Won', lost: 'Lost', no_bid: 'No bid',
};
