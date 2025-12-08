"use client";

import { CheckCircle2, CircleDashed, Clock, XCircle, FileText, Cpu, Database, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils"; 

// Defining types based on the data structure used by the parent component (TagPageClient.tsx)
interface AuditTrailEvent {
  id: string;
  type: string;
  label: string;
  timestamp: number;
  status: string;
  details?: string;
}

interface AuditTrailType {
  _id: string;
  mediaId: string;
  events: AuditTrailEvent[];
  lastUpdated: number;
  linkedHash: string;
}

interface AuditTrailModalProps {
  isVisible: boolean;
  onClose: () => void;
  trailData: AuditTrailType | undefined | null; 
  linkedHash: string; 
}

const getEventIcon = (type: string) => {
  switch (type) {
    case "FILE_UPLOAD": return FileText;
    case "AI_VERIFICATION": return Cpu;
    case "METAMASK_SIGN": return Wallet;
    case "DB_UPLOAD": return Database;
    default: return CheckCircle2;
  }
};

export default function AuditTrailModal({ isVisible, onClose, trailData, linkedHash }: AuditTrailModalProps) {
  if (!isVisible) return null;

  const trail = trailData;

  return (
    // Modal Overlay
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" 
      onClick={onClose}
    >
      {/* Modal Content */}
      <div 
        className="bg-[#1A1A1A] rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 transform transition-all duration-300 scale-100 opacity-100 border border-gray-800" 
        onClick={(e) => e.stopPropagation()}
      >
        
        {/* Modal Header */}
        <div className="flex justify-between items-center pb-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-400" /> Registration History
          </h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white transition-colors p-1 rounded-full hover:bg-gray-700"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Audit Trail Content or No Data Message */}
        {(!trail || trail.events.length === 0) ? (
            <div className="pt-4 text-gray-400">
                Audit trail data not found or linked.
            </div>
        ) : (
            <div className="pt-6">
                <p className="text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wider">
                    Linked Hash: <span className="font-mono break-all">{linkedHash}</span>
                </p>
                <div className="relative pl-4 border-l border-gray-700 space-y-6 max-h-[70vh] overflow-y-auto pr-2">
                    {trail.events.map((event, index) => {
            
                        const Icon = getEventIcon(event.type);

                        return (
                            <div key={event.id} className="relative">
                            
                                <div className={cn(
                                    "absolute -left-[21px] top-1 rounded-full p-1 border-2 bg-[#181A1D] z-10",
                                    event.status === "SUCCESS" ? "border-green-500 text-green-500" :
                                    event.status === "ERROR" ? "border-red-500 text-red-500" :
                                    "border-blue-500 text-blue-500"
                                )}>
                                    {event.status === "SUCCESS" ? <CheckCircle2 className="w-3 h-3" /> :
                                    event.status === "ERROR" ? <XCircle className="w-3 h-3" /> :
                                    <CircleDashed className="w-3 h-3 animate-spin-slow" />}
                                </div>


                                <div className="flex flex-col">
                                    <div className="flex justify-between items-start">
                                    <span className="text-sm font-medium text-gray-200 flex items-center gap-2">
                                        <Icon className="w-3 h-3 opacity-70" /> {event.label}
                                    </span>
                                    <span className="text-xs text-gray-500 tabular-nums flex-shrink-0">
                                        {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                    </span>
                                    </div>
                                    
                                    {event.details && (
                                    <p className="text-xs text-gray-500 mt-1 font-mono break-all bg-black/20 p-1 rounded">
                                        {event.details}
                                    </p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        )}
      </div>
    </div>
  );
}