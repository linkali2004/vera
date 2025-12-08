
export type AuditEventType = 
  | "FILE_UPLOAD" 
  | "AI_VERIFICATION" 
  | "ON_CHAIN_CHECK" 
  | "METAMASK_SIGN" 
  | "DB_UPLOAD" 
  | "REGISTRATION_COMPLETE";

export type AuditStatus = "PENDING" | "SUCCESS" | "ERROR";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  label: string; 
  timestamp: number;
  status: AuditStatus;
  details?: string; 
}

export interface AuditTrail {
  mediaId: string; 
  events: AuditEvent[];
  lastUpdated: number;
}

const STORAGE_KEY = "media_audit_trail";



export const getAuditTrail = (): AuditTrail | null => {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored) : null;
};

export const initAuditTrail = (mediaId: string) => {
  const newTrail: AuditTrail = {
    mediaId,
    events: [],
    lastUpdated: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(newTrail));
  return newTrail;
};

export const logAuditEvent = (
  type: AuditEventType, 
  label: string, 
  status: AuditStatus, 
  details?: string
) => {
  const currentTrail = getAuditTrail();
  if (!currentTrail) return;

  const newEvent: AuditEvent = {
    id: crypto.randomUUID(),
    type,
    label,
    timestamp: Date.now(),
    status,
    details
  };

  currentTrail.events.push(newEvent);
  currentTrail.lastUpdated = Date.now();
  
  localStorage.setItem(STORAGE_KEY, JSON.stringify(currentTrail));
  
  window.dispatchEvent(new Event("audit-trail-updated"));
};

export const clearAuditTrail = () => {
  localStorage.removeItem(STORAGE_KEY);
};