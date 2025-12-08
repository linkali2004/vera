"use client";

import AuditTrailModal from "@/components/custom/audit-trail";
import ConfirmationModal from "@/components/custom/confirmation-modal";
import LoadingModal from "@/components/custom/loading-modal";
import LoadingScreen from "@/components/custom/loading-screen";
import { Button } from "@/components/ui/button";
import {
  API_ENDPOINTS,
  NEXT_PUBLIC_PINATA_GATEWAY_TOKEN,
  NEXT_PUBLIC_PINATA_GATEWAY_URL,
  NEXT_PUBLIC_PINATA_JWT,
  NEXT_PUBLIC_WATERMARK_URL,
} from "@/lib/config";
import CryptoJS from "crypto-js";
import { ethers, type TransactionResponse } from "ethers";
import {
  BadgeCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Music,
  Share2,
  Trash2,
  Info,
  Clock,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast, { Toaster } from "react-hot-toast";


const ABI = [
  "function registerMedia(string memory mediaCid, string memory metadataCid, bytes32 contentHash) public",
  "function deregisterMedia(bytes32 contentHash) public",
  "function getMedia(bytes32 contentHash) public view returns (string memory mediaCid, string memory metadataCid, address uploader, uint256 timestamp)",
  "function getMediaByOwner(address owner) public view returns (bytes32[] memory)",
  "error MediaAlreadyRegistered(bytes32 contentHash)",
  "error MediaNotFound(bytes32 contentHash)",
  "error Unauthorized()",
  "error MediaNotRegistered(bytes32 contentHash)",
  "error NotOwner()",
  "error AlreadyDeregistered(bytes32 contentHash)",
];

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

function getEthersContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS as string, ABI, signerOrProvider);
}

function formatHashForContract(hashAddress: string): string {
  let cleanHash = hashAddress.trim();

  if (!cleanHash.startsWith("0x")) {
    cleanHash = "0x" + cleanHash;
  }

  if (cleanHash.length !== 66) {
    throw new Error(
      `Invalid hash format. Expected 66 characters (0x + 64 hex), got ${cleanHash.length}: ${cleanHash}`
    );
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(cleanHash)) {
    throw new Error(`Invalid hex format: ${cleanHash}`);
  }

  return cleanHash;
}

function decodeCustomError(errorData: string) {
  const errorSelectors = {
    "0x6999de4a": "MediaNotFound",
    "0xaa31b366": "MediaNotRegistered",
    "0x30c41534": "Unauthorized",
    "0x4f6de9d0": "NotOwner",
    "0xe7e78fd5": "AlreadyDeregistered",
    "0x95c1cb93": "MediaAlreadyRegistered",
  };

  const selector = errorData.slice(0, 10);
  return (
    errorSelectors[selector as keyof typeof errorSelectors] || "UnknownError"
  );
}

function getCategoricalProbabilities(naturalProbability: number, detectionResult?: any) {
  const displayNatural = detectionResult?.natural_probability || naturalProbability;
  const displayDeepfake = detectionResult?.deepfake_probability || (100 - naturalProbability);
  
  let status: string;
  if (displayNatural >= 90) {
    status = "AUTHENTIC";
  } else if (displayNatural >= 70) {
    status = "INCONCLUSIVE";
  } else {
    status = "SYNTHETIC";
  }

  return {
    displayNatural,
    displayDeepfake,
    status,
    originalNatural: naturalProbability,
    originalDeepfake: 100 - naturalProbability
  };
}

async function generateContentHash(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    const wordArray = CryptoJS.lib.WordArray.create(arrayBuffer);

    const hashHex = CryptoJS.SHA256(wordArray).toString();

    const keccakHash = ethers.keccak256("0x" + hashHex);
    return keccakHash;
  } catch (error) {
    console.error("Error generating content hash:", error);
    throw new Error("Failed to generate content hash from file object");
  }
}

async function unpinFromPinata(cid: string) {
  const pinataJWT = NEXT_PUBLIC_PINATA_JWT;
  if (!pinataJWT) throw new Error("Pinata JWT is not configured.");

  const res = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${pinataJWT}`,
    },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Failed to unpin from Pinata: ${res.statusText} - ${errorBody}`
    );
  }
}

interface AuditTrailEvent {
  id: string;
  type: string;
  label: string;
  timestamp: number;
  status: string;
  details?: string;
}

interface AuditTrailData {
  _id: string;
  mediaId: string;
  events: AuditTrailEvent[];
  lastUpdated: number;
  linkedHash: string;
}

interface Tag {
  _id: string;
  file_name: string;
  description?: string;
  hash_address: string;
  address: string;
  type: "img" | "video" | "audio";
  primary_media_url: string;
  createdAt: string;
  mediacid: string;
  metadatacid: string;
  img_urls?: string[];
  video_urls?: string[];
  audio_urls?: string[];
  file_count?: number;
  is_bulk_upload?: boolean;
  audit_trail_id?: string;
  audit_trail?: AuditTrailData;
}

interface Metadata {
  fileName: string;
  description: string;
  signerAddress: string;
  probabilities: {
    deepfake: number;
    natural: number;
  };
  contentAnalysis: string;
  authenticIndicators?: string;
  deepfakeIndicators?: string;
  isBulkUpload?: boolean;
  totalFiles?: number;
  files?: Array<{
    name: string;
    description: string;
    mediaType: string;
    detectionResult: any;
    cloudinaryUrl: string;
  }>;
}

interface TagPageClientProps {
  id: string;
}

export default function TagPageClient({ id }: TagPageClientProps) {
  const router = useRouter();
  const [tag, setTag] = useState<Tag | null>(null);
  const [metadata, setMetadata] = useState<Metadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(true);
  const [currentUserAddress, setCurrentUserAddress] = useState<string | null>(
    null
  );
  const [isDeregistering, setIsDeregistering] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  const [isAuditTrailVisible, setIsAuditTrailVisible] = useState(false); 
  const [isAuditTrailFetching, setIsAuditTrailFetching] = useState(false);

  const [loadingModal, setLoadingModal] = useState({
    isVisible: false,
    title: "",
    subtitle: "",
    steps: [] as { text: string; completed: boolean }[],
    progress: 0,
    iconType: "default" as "default" | "download" | "delete" | "verify" | "ai",
  });

  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [isFilesDropdownOpen, setIsFilesDropdownOpen] = useState(false);
  const [confirmationModal, setConfirmationModal] = useState({
    isVisible: false,
    type: "delete" as "delete" | "download",
    title: "",
    message: "",
    onConfirm: () => {},
  });

  useEffect(() => {
    const getAddress = async () => {
      if (typeof window.ethereum !== "undefined") {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          setCurrentUserAddress(await signer.getAddress());
        } catch (err) {
          console.error("Could not get wallet address:", err);
        }
      }
    };
    getAddress();
  }, []);

  useEffect(() => {
    if (!id) {
      setError("Tag ID is missing from the URL.");
      setIsLoading(false);
      return;
    }

    const fetchTagData = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/tags/${id}`
        );
        if (!response.ok) throw new Error("Failed to fetch the tag data.");
        const result = await response.json();
        if (result.status !== "success" || !result.data.tag)
          throw new Error("The requested tag could not be found.");
        
        setTag(result.data.tag);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTagData();
  }, [id]);

  useEffect(() => {
    if (!tag?.audit_trail_id || tag.audit_trail) return;

    const fetchAuditTrail = async () => {
      setIsAuditTrailFetching(true);
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/audit-trail/${tag.audit_trail_id}`
        );
        if (!response.ok)
          throw new Error("Failed to fetch audit trail data.");
        const result = await response.json();
        
        if (result.status === "success" && result.data.auditTrail) {
          setTag(prevTag => {
            if (prevTag && prevTag._id === id) {
              return {
                ...prevTag,
                audit_trail: result.data.auditTrail,
              };
            }
            return prevTag;
          });
        }
      } catch (err) {
        console.error("Audit Trail fetch error:", err);
      } finally {
        setIsAuditTrailFetching(false);
      }
    };

    fetchAuditTrail();
  }, [tag, id]);

  useEffect(() => {
    if (!tag?.metadatacid) {
      setIsMetadataLoading(false);
      return;
    }

    const fetchMetadata = async () => {
      setIsMetadataLoading(true);
      try {
        const gatewayUrl = NEXT_PUBLIC_PINATA_GATEWAY_URL;
        const gatewayToken = NEXT_PUBLIC_PINATA_GATEWAY_TOKEN;
        if (!gatewayUrl || !gatewayToken)
          throw new Error("Pinata gateway configuration is missing.");

        const response = await fetch(
          `${gatewayUrl}/ipfs/${tag.metadatacid}?pinataGatewayToken=${gatewayToken}`
        );
        if (!response.ok)
          throw new Error("Could not fetch metadata from IPFS.");
        const data = await response.json();
        setMetadata(data);
      } catch (err) {
        console.error("IPFS metadata fetch error:", err);
      } finally {
        setIsMetadataLoading(false);
      }
    };

    fetchMetadata();
  }, [tag]);

  useEffect(() => {
    setCurrentMediaIndex(0);
  }, [tag]);

  const handleDownload = () => {
    if (!tag?.primary_media_url) {
      toast.error("No media file found to download.");
      return;
    }

    setIsDownloading(true);
    setLoadingModal({
      isVisible: true,
      title: "Preparing Download",
      subtitle: "Applying watermark and registering media...",
      steps: [
        { text: "Applying watermark to media", completed: false },
        { text: "Generating content hash", completed: false },
        { text: "Checking blockchain registration", completed: false },
        { text: "Registering media if needed", completed: false },
        { text: "Preparing download", completed: false },
      ],
      progress: 0,
      iconType: "download",
    });

    performDownload();
  };

  const performDownload = async () => {
    if (!tag?.primary_media_url) {
      toast.error("No media file found to download.");
      return;
    }

    try {
      if (tag.type === "video" || tag.type === "img") {
        setLoadingModal((prev) => ({
          ...prev,
          progress: 20,
          steps: prev.steps.map((step, index) =>
            index === 0 ? { ...step, completed: true } : step
          ),
        }));

        const payload = {
          mediaUrl: tag.primary_media_url,
          watermarkUrl: NEXT_PUBLIC_WATERMARK_URL,
          mediaType: tag.type,
        };

        const watermarkResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/tags/watermark`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        if (!watermarkResponse.ok) {
          const errorData = await watermarkResponse.json();
          throw new Error(errorData.message || "Failed to apply watermark.");
        }

        const result = await watermarkResponse.json();
        let watermarkedUrl = result.data.watermarkedUrl;

        if (!watermarkedUrl) {
          throw new Error("Backend did not return a watermarked URL.");
        }

        if (watermarkedUrl.startsWith("http://")) {
          watermarkedUrl = watermarkedUrl.replace("http://", "https://");
        }

        setLoadingModal((prev) => ({
          ...prev,
          progress: 40,
          steps: prev.steps.map((step, index) =>
            index === 1 ? { ...step, completed: true } : step
          ),
        }));

        const watermarkedResponse = await fetch(watermarkedUrl);
        if (!watermarkedResponse.ok) {
          throw new Error("Failed to fetch watermarked file");
        }

        const watermarkedBlob = await watermarkedResponse.blob();
        const watermarkedFile = new File(
          [watermarkedBlob],
          `watermarked_${tag.file_name}`,
          {
            type: watermarkedBlob.type,
          }
        );

        const keccakHash = await generateContentHash(watermarkedFile);

        console.log("Generated hash from watermarked file:", keccakHash);

        setLoadingModal((prev) => ({
          ...prev,
          progress: 60,
          steps: prev.steps.map((step, index) =>
            index === 2 ? { ...step, completed: true } : step
          ),
        }));

        if (typeof window.ethereum === "undefined") {
          throw new Error(
            "MetaMask is not installed. Please install MetaMask to download watermarked media."
          );
        }

        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const contract = getEthersContract(signer);

        let isOriginalMediaRegistered = false;
        try {
          const existingMedia = await contract.getMedia(keccakHash);
          isOriginalMediaRegistered = existingMedia.mediaCid !== "";
          console.log(
            "Original media registration status:",
            isOriginalMediaRegistered
          );
        } catch (error) {
          isOriginalMediaRegistered = false;
          console.log("Original media not found in contract:", error);
        }

        if (!isOriginalMediaRegistered) {
          setLoadingModal((prev) => ({
            ...prev,
            progress: 80,
            steps: prev.steps.map((step, index) =>
              index === 3 ? { ...step, completed: true } : step
            ),
          }));

          const originalMediaCid = "QmOriginalMediaCid" + Date.now();
          const originalMetadataCid = "QmOriginalMetadataCid" + Date.now();

          console.log("Registering original media with:", {
            mediaCid: originalMediaCid,
            metadataCid: originalMetadataCid,
            contentHash: keccakHash,
          });

          try {
            const tx = await contract.registerMedia(
              originalMediaCid,
              originalMetadataCid,
              keccakHash
            );

            console.log("Registration transaction:", tx.hash);
            await tx.wait();

            console.log("Original media successfully registered to blockchain");
          } catch (registrationError: any) {
            console.error("Registration error:", registrationError);

            if (
              registrationError.message?.includes("MediaAlreadyRegistered") ||
              registrationError.message?.includes("already registered") ||
              registrationError.message?.includes("MediaAlreadyRegistered")
            ) {
              console.log(
                "Media was already registered by another transaction, continuing..."
              );
              setLoadingModal((prev) => ({
                ...prev,
                progress: 80,
                steps: prev.steps.map((step, index) =>
                  index === 3 ? { ...step, completed: true } : step
                ),
              }));
            } else {
              console.error(
                "Unexpected registration error:",
                registrationError
              );
              throw registrationError;
            }
          }
        } else {
          setLoadingModal((prev) => ({
            ...prev,
            progress: 80,
            steps: prev.steps.map((step, index) =>
              index === 3 ? { ...step, completed: true } : step
            ),
          }));
          console.log(
            "Original media already registered, proceeding to download"
          );
        }

        setLoadingModal((prev) => ({
          ...prev,
          progress: 100,
          steps: prev.steps.map((step, index) =>
            index === 4 ? { ...step, completed: true } : step
          ),
        }));

        const a = document.createElement("a");
        a.href = watermarkedUrl;
        a.download = `watermarked_${tag.file_name}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setTimeout(() => {
          setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        }, 1000);
      } else {
        setLoadingModal((prev) => ({
          ...prev,
          progress: 100,
          steps: prev.steps.map((step, index) =>
            index === 4 ? { ...step, completed: true } : step
          ),
        }));

        const response = await fetch(tag.primary_media_url);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = tag.file_name || "media_file";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);

        setTimeout(() => {
          setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        }, 1000);
      }
    } catch (err: any) {
      console.error("Download/Watermark error:", err);
      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      toast.error(err.message || "An error occurred during download.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleShare = async () => {
    if (!tag?.primary_media_url) {
      toast.error("No media available to share.");
      return;
    }

    const shareData = {
      title: tag.file_name,
      text: tag.description || "Check out this verified media!",
      url: window.location.href,
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
        toast.success("Shared successfully!");
      } else {
        await navigator.clipboard.writeText(shareData.url);
        toast.success("Link copied to clipboard!");
      }
    } catch (err: any) {
      console.error("Share error:", err);
      toast.error("Failed to share link.");
    }
  };

  const handleDeregister = () => {
    if (!tag || !currentUserAddress) {
      toast.error("Cannot perform action. Data is missing.");
      return;
    }
    if (currentUserAddress.toLowerCase() !== tag.address.toLowerCase()) {
      toast.error("You are not authorized to deregister this media.");
      return;
    }
    if (typeof window.ethereum === "undefined") {
      toast.error("MetaMask is not installed.");
      return;
    }

    setConfirmationModal({
      isVisible: true,
      type: "delete",
      title: "Delete Media",
      message: `Are you sure you want to permanently delete "${tag.file_name}"? This action cannot be undone and will remove the media from the blockchain and all storage systems.`,
      onConfirm: () => {
        setConfirmationModal((prev) => ({ ...prev, isVisible: false }));
        performDeregister();
      },
    });
  };

  const performDeregister = async () => {
    if (!tag || !currentUserAddress) {
      toast.error("Cannot perform action. Data is missing.");
      return;
    }

    setIsDeregistering(true);
    setLoadingModal({
      isVisible: true,
      title: "Deleting Media",
      subtitle: "Removing media from blockchain and storage...",
      steps: [
        { text: "Checking media status on blockchain", completed: false },
        { text: "Awaiting blockchain transaction", completed: false },
        { text: "Unpinning files from IPFS", completed: false },
        { text: "Deleting from database", completed: false },
        { text: "Deletion complete", completed: false },
      ],
      progress: 0,
      iconType: "delete",
    });

    try {
      if (typeof window.ethereum === "undefined") {
        throw new Error("MetaMask is not installed.");
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = getEthersContract(signer);

      let formattedHash: string;
      try {
        formattedHash = formatHashForContract(tag.hash_address);
        console.log("Using hash for deregistration:", formattedHash);
      } catch (hashError: any) {
        console.error("Hash formatting error:", hashError);
        throw new Error(`Invalid media hash format: ${hashError.message}`);
      }

      setLoadingModal((prev) => ({
        ...prev,
        progress: 20,
        steps: prev.steps.map((step, index) =>
          index === 0 ? { ...step, completed: true } : step
        ),
      }));
      try {
        const mediaData = await contract.getMedia(formattedHash);
        if (
          mediaData.uploader.toLowerCase() !== currentUserAddress.toLowerCase()
        ) {
          throw new Error("You are not the original uploader of this media.");
        }
      } catch (getMediaError: any) {
        console.error("Error checking media on blockchain:", getMediaError);
        if (getMediaError.message?.includes("MediaNotFound")) {
          throw new Error("This media is not registered on the blockchain.");
        }
        throw new Error("Failed to verify media status on blockchain.");
      }

      setLoadingModal((prev) => ({
        ...prev,
        progress: 40,
        steps: prev.steps.map((step, index) =>
          index === 1 ? { ...step, completed: true } : step
        ),
      }));

      try {
        await contract.deregisterMedia.estimateGas(formattedHash);
      } catch (estimateError: any) {
        console.error("Gas estimation failed:", estimateError);
        if (
          estimateError.message?.includes("MediaNotFound") ||
          estimateError.message?.includes("MediaNotRegistered")
        ) {
          throw new Error("This media is not registered on the blockchain.");
        }
        if (
          estimateError.message?.includes("Unauthorized") ||
          estimateError.message?.includes("NotOwner")
        ) {
          throw new Error("You are not authorized to deregister this media.");
        }
        if (estimateError.message?.includes("AlreadyDeregistered")) {
          throw new Error("This media has already been deregistered.");
        }
        throw new Error(
          `Transaction will fail: ${estimateError.message || "Unknown error"}`
        );
      }

      const tx: TransactionResponse = await contract.deregisterMedia(
        formattedHash
      );
      await tx.wait();

      setLoadingModal((prev) => ({
        ...prev,
        progress: 60,
        steps: prev.steps.map((step, index) =>
          index === 2 ? { ...step, completed: true } : step
        ),
      }));
      await Promise.all([
        unpinFromPinata(tag!.mediacid),
        unpinFromPinata(tag!.metadatacid),
      ]);

      setLoadingModal((prev) => ({
        ...prev,
        progress: 80,
        steps: prev.steps.map((step, index) =>
          index === 3 ? { ...step, completed: true } : step
        ),
      }));

      const deleteResponse = await fetch(API_ENDPOINTS.TAG_BY_ID(id), {
        method: "DELETE",
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json();
        console.error("Database deletion failed:", {
          status: deleteResponse.status,
          statusText: deleteResponse.statusText,
          errorData,
          url: API_ENDPOINTS.TAG_BY_ID(id),
        });
        throw new Error(errorData.message || "Failed to delete from database.");
      }

      setLoadingModal((prev) => ({
        ...prev,
        progress: 100,
        steps: prev.steps.map((step, index) =>
          index === 4 ? { ...step, completed: true } : step
        ),
      }));

      setTimeout(() => {
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        router.push("/");
      }, 1000);
    } catch (err: any) {
      console.error("Deregister error:", err);

      let errorMessage =
        err.reason || err.message || "Failed to deregister media.";

      if (err.data) {
        const decodedError = decodeCustomError(err.data);

        switch (decodedError) {
          case "MediaNotFound":
          case "MediaNotRegistered":
            errorMessage = "This media is not registered on the blockchain.";
            break;
          case "Unauthorized":
          case "NotOwner":
            errorMessage = "You are not authorized to deregister this media.";
            break;
          case "AlreadyDeregistered":
            errorMessage = "This media has already been deregistered.";
            break;
          default:
            errorMessage = `Smart contract error: ${decodedError}`;
        }
      }

      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      toast.error(errorMessage);
    } finally {
      setIsDeregistering(false);
    }
  };

  if (isLoading) {
    return (
      <LoadingScreen
        message="Loading Media Details"
        subMessage="Fetching content and verifying authenticity"
      />
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[#1A1A1A] text-white flex items-center justify-center">
        <div className="text-xl text-red-400">Error: {error}</div>
      </main>
    );
  }

  if (!tag) {
    return (
      <main className="min-h-screen bg-[#1A1A1A] text-white flex items-center justify-center">
        <div className="text-xl">Tag not found.</div>
      </main>
    );
  }

  const isOwner =
    currentUserAddress &&
    tag &&
    currentUserAddress.toLowerCase() === tag.address.toLowerCase();
  const isProcessing = isDeregistering || isDownloading;

  const handleCancelModal = () => {
    setConfirmationModal((prev) => ({ ...prev, isVisible: false }));
  };

  return (
    <main className="min-h-screen bg-[#1A1A1A] text-white overflow-x-hidden">
      <LoadingModal
        isVisible={loadingModal.isVisible}
        title={loadingModal.title}
        subtitle={loadingModal.subtitle}
        steps={loadingModal.steps}
        progress={loadingModal.progress}
        showSecurityNote={true}
        iconType={loadingModal.iconType}
      />
      <ConfirmationModal
        isVisible={confirmationModal.isVisible}
        type={confirmationModal.type}
        title={confirmationModal.title}
        message={confirmationModal.message}
        onConfirm={confirmationModal.onConfirm}
        onCancel={handleCancelModal}
        isLoading={isDeregistering}
        loadingText={isDeregistering ? "Deleting media..." : "Processing..."}
      />
      
      <AuditTrailModal 
        isVisible={isAuditTrailVisible}
        onClose={() => setIsAuditTrailVisible(false)}
        trailData={tag.audit_trail}
        linkedHash={tag.hash_address}
      />

      <div className="max-w-7xl mx-auto p-4 sm:p-6 w-full">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 items-start w-full">
          <div className="relative">
            {tag.is_bulk_upload ? (
              <div className="space-y-4">
                <div className="aspect-[1/1] w-full max-w-lg mx-auto xl:mx-0 overflow-hidden rounded-[20px] bg-black flex items-center justify-center relative">
                  {(() => {
                    const allMediaUrls = [
                      ...(tag.img_urls || []),
                      ...(tag.video_urls || []),
                      ...(tag.audio_urls || []),
                    ];
                    const currentUrl = allMediaUrls[currentMediaIndex];
                    const isImage = tag.img_urls?.includes(currentUrl);
                    const isVideo = tag.video_urls?.includes(currentUrl);

                    if (isVideo) {
                      return (
                        <video
                          src={currentUrl}
                          className="w-full h-full object-cover"
                          controls
                          autoPlay
                          muted
                          loop
                          playsInline
                        >
                          Your browser does not support the video tag.
                        </video>
                      );
                    } else if (isImage) {
                      return (
                        <Image
                          src={currentUrl}
                          alt={`${tag.file_name} - File ${
                            currentMediaIndex + 1
                          }`}
                          fill
                          className="object-cover"
                          priority
                        />
                      );
                    } else {
                      return (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 p-4">
                          <Music className="w-24 h-24 text-gray-500 mb-4" />
                          <audio src={currentUrl} controls className="w-full">
                            Your browser does not support the audio element.
                          </audio>
                        </div>
                      );
                    }
                  })()}

                  {(() => {
                    const allMediaUrls = [
                      ...(tag.img_urls || []),
                      ...(tag.video_urls || []),
                      ...(tag.audio_urls || []),
                    ];
                    if (allMediaUrls.length > 1) {
                      return (
                        <>
                          <button
                            onClick={() =>
                              setCurrentMediaIndex(
                                Math.max(0, currentMediaIndex - 1)
                              )
                            }
                            disabled={currentMediaIndex === 0}
                            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                          >
                            <ChevronLeft className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() =>
                              setCurrentMediaIndex(
                                Math.min(
                                  allMediaUrls.length - 1,
                                  currentMediaIndex + 1
                                )
                              )
                            }
                            disabled={
                              currentMediaIndex === allMediaUrls.length - 1
                            }
                            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                          >
                            <ChevronRight className="w-5 h-5" />
                          </button>
                        </>
                      );
                    }
                    return null;
                  })()}
                </div>

                {(() => {
                  const allMediaUrls = [
                    ...(tag.img_urls || []),
                    ...(tag.video_urls || []),
                    ...(tag.audio_urls || []),
                  ];
                  if (allMediaUrls.length > 1) {
                    return (
                      <div className="flex items-center justify-center space-x-4">
                        <span className="text-sm text-gray-400">
                          {currentMediaIndex + 1} of {allMediaUrls.length}
                        </span>
                        <div className="flex space-x-2">
                          {allMediaUrls.map((_, index) => (
                            <button
                              key={index}
                              onClick={() => setCurrentMediaIndex(index)}
                              className={`w-2 h-2 rounded-full transition-colors duration-200 ${
                                index === currentMediaIndex
                                  ? "bg-white"
                                  : "bg-white/50"
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            ) : (
              <div className="aspect-[1/1] w-full max-w-lg mx-auto xl:mx-0 overflow-hidden rounded-[20px] bg-black flex items-center justify-center">
                {tag.type === "video" ? (
                  <video
                    src={tag.primary_media_url}
                    className="w-full h-full object-cover"
                    controls
                    autoPlay
                    muted
                    loop
                    playsInline
                  >
                    Your browser does not support the video tag.
                  </video>
                ) : tag.type === "audio" ? (
                  <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 p-4">
                    <Music className="w-24 h-24 text-gray-500 mb-4" />
                    <audio
                      src={tag.primary_media_url}
                      controls
                      className="w-full"
                    >
                      Your browser does not support the audio element.
                    </audio>
                  </div>
                ) : (
                  <Image
                    src={tag.primary_media_url}
                    alt={tag.file_name}
                    fill
                    className="object-cover"
                    priority
                  />
                )}
              </div>
            )}
          </div>
          <div className="space-y-4 sm:space-y-6 w-full min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
              <h1 className="text-xl sm:text-2xl xl:text-3xl font-bold text-white break-all overflow-hidden">
                {tag.file_name}
              </h1>
              {tag.is_bulk_upload && tag.file_count && (
                <div className="bg-blue-500 text-white text-sm font-bold px-3 py-1 rounded-full">
                  {tag.file_count} files
                </div>
              )}
              <div className="w-6 h-6 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                <BadgeCheck className="w-4 h-4 text-white" />
              </div>
            </div>
            <div className="space-y-4 text-gray-300 leading-relaxed overflow-hidden min-w-0">
              <div>
                {isMetadataLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                    <span className="text-gray-400">Loading...</span>
                  </div>
                ) : (
                  metadata?.description || "No description provided."
                )}
              </div>
              <div className="pt-4 border-t border-gray-700 space-y-4 min-w-0">
                <h2 className="text-lg font-semibold text-white">
                  AI Analysis Report
                </h2>
                {isMetadataLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin"></div>
                    <span className="text-sm text-gray-400">
                      Loading analysis...
                    </span>
                  </div>
                ) : metadata ? (
                  <>
                    {metadata.isBulkUpload ? (
                      <>
                        {(() => {
                          const currentFile = metadata.files?.[currentMediaIndex];
                          const naturalProb = currentFile?.detectionResult?.natural_probability || 0;
                          const detectionResult = currentFile?.detectionResult;
                          const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                          
                          return (
                            <>
                              <div>
                                <p className="text-xs font-semibold text-gray-400 mb-2">
                                  PROBABILITY (File {currentMediaIndex + 1})
                                </p>
                                <div className="w-full bg-gray-700 rounded-full h-2.5 flex overflow-hidden">
                                  <div
                                    className="bg-green-500 h-2.5"
                                    style={{
                                      width: `${categorical.displayNatural}%`,
                                    }}
                                  ></div>
                                  <div
                                    className="bg-yellow-500 h-2.5"
                                    style={{
                                      width: `${categorical.displayDeepfake}%`,
                                    }}
                                  ></div>
                                </div>
                                <div className="flex justify-between text-xs mt-1">
                                  <span className="text-green-400">
                                  Authentic: {categorical.displayNatural}%
                                  </span>
                                  <span className="text-yellow-400">
                                    Deepfake: {categorical.displayDeepfake}%
                                  </span>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-400 mb-1">
                                  CATEGORICAL STATUS
                                </p>
                                <p className={`text-sm font-bold ${
                                  categorical.status === "AUTHENTIC" ? "text-green-400" :
                                  categorical.status === "INCONCLUSIVE" ? "text-yellow-400" :
                                  "text-red-400"
                                }`}>
                                  {categorical.status}
                                </p>
                              </div>
                            </>
                          );
                        })()}
                        {metadata.files?.[currentMediaIndex]?.detectionResult?.reasoning?.authentic_indicators && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-1">
                              AUTHENTIC INDICATORS
                            </p>
                            <p className="text-sm text-green-300 break-words">
                              {metadata.files?.[currentMediaIndex]?.detectionResult?.reasoning?.authentic_indicators}
                            </p>
                          </div>
                        )}
                        {metadata.files?.[currentMediaIndex]?.detectionResult?.reasoning?.deepfake_indicators && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-1">
                              DEEPFAKE INDICATORS
                            </p>
                            <p className="text-sm text-yellow-300 break-words">
                              {metadata.files?.[currentMediaIndex]?.detectionResult?.reasoning?.deepfake_indicators}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold text-gray-400 mb-1">
                            FILE DETAILS
                          </p>
                          <p className="font-mono text-sm text-white break-all overflow-hidden">
                            {metadata.files?.[currentMediaIndex]?.name ||
                              "Unknown"}{" "}
                            (
                            {metadata.files?.[currentMediaIndex]?.mediaType ||
                              "Unknown"}
                            )
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        {(() => {
                          const naturalProb = metadata.probabilities?.natural || 0;
                          const detectionResult = (metadata as any).detectionResult;
                          const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                          return (
                            <>
                              <div>
                                <p className="text-xs font-semibold text-gray-400 mb-2">
                                  PROBABILITY
                                </p>
                                <div className="w-full bg-gray-700 rounded-full h-2.5 flex overflow-hidden">
                                  <div
                                    className="bg-green-500 h-2.5"
                                    style={{
                                      width: `${categorical.displayNatural}%`,
                                    }}
                                  ></div>
                                  <div
                                    className="bg-yellow-500 h-2.5"
                                    style={{
                                      width: `${categorical.displayDeepfake}%`,
                                    }}
                                  ></div>
                                </div>
                                <div className="flex justify-between text-xs mt-1">
                                  <span className="text-green-400">
                                    Authentic: {categorical.displayNatural}%
                                  </span>
                                  <span className="text-yellow-400">
                                    Deepfake: {categorical.displayDeepfake}%
                                  </span>
                                </div>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-400 mb-1">
                                  CATEGORICAL STATUS
                                </p>
                                <p className={`text-sm font-bold ${
                                  categorical.status === "AUTHENTIC" ? "text-green-400" :
                                  categorical.status === "INCONCLUSIVE" ? "text-yellow-400" :
                                  "text-red-400"
                                }`}>
                                  {categorical.status}
                                </p>
                              </div>
                            </>
                          );
                        })()}
                        <div>
                          <p className="text-xs font-semibold text-gray-400 mb-1">
                            CONTENT ANALYSIS
                          </p>
                          <p className="text-sm text-gray-300 break-words">
                            {metadata.contentAnalysis}
                          </p>
                        </div>
                        {metadata.authenticIndicators && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-1">
                              AUTHENTIC INDICATORS
                            </p>
                            <p className="text-sm text-green-300 break-words">
                              {metadata.authenticIndicators}
                            </p>
                          </div>
                        )}
                        {metadata.deepfakeIndicators && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 mb-1">
                              DEEPFAKE INDICATORS
                            </p>
                            <p className="text-sm text-yellow-300 break-words">
                              {metadata.deepfakeIndicators}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-semibold text-gray-400 mb-1">
                            REGISTERED BY
                          </p>
                          <p className="font-mono text-sm text-white break-all overflow-hidden">
                            {metadata.signerAddress}
                          </p>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-red-400">
                    Could not load analysis report.
                  </p>
                )}
              </div>
            </div>

            {tag.is_bulk_upload &&
              (() => {
                const allMediaUrls = [
                  ...(tag.img_urls || []),
                  ...(tag.video_urls || []),
                  ...(tag.audio_urls || []),
                ];

                if (allMediaUrls.length > 1) {
                  return (
                    <div className="space-y-2 min-w-0">
                      <button
                        onClick={() =>
                          setIsFilesDropdownOpen(!isFilesDropdownOpen)
                        }
                        className="flex items-center justify-between w-full p-3 bg-[#2D2D30] border border-gray-600 rounded-lg hover:bg-[#3D3D40] transition-colors duration-200"
                      >
                        <span className="text-sm font-medium text-white">
                          Files in Collection ({allMediaUrls.length})
                        </span>
                        {isFilesDropdownOpen ? (
                          <ChevronUp className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        )}
                      </button>

                      {isFilesDropdownOpen && (
                        <div className="space-y-2 max-h-60 overflow-y-auto w-full">
                          {allMediaUrls.map((url, index) => {
                            const isImage = tag.img_urls?.includes(url);
                            const isVideo = tag.video_urls?.includes(url);
                            const isAudio = tag.audio_urls?.includes(url);

                            return (
                              <div
                                key={index}
                                onClick={() => setCurrentMediaIndex(index)}
                                className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors duration-200 ${
                                  currentMediaIndex === index
                                    ? "bg-blue-500/20 border border-blue-500/50"
                                    : "bg-[#2D2D30] hover:bg-[#3D3D40]"
                                }`}
                              >
                                <div className="w-8 h-8 bg-gray-700 rounded flex items-center justify-center flex-shrink-0">
                                  {isImage ? (
                                    <Image
                                      src={url}
                                      alt={`File ${index + 1}`}
                                      width={32}
                                      height={32}
                                      className="w-full h-full object-cover rounded"
                                    />
                                  ) : isVideo ? (
                                    <div className="w-6 h-6 bg-red-500 rounded flex items-center justify-center">
                                      <span className="text-white text-xs">
                                        ▶
                                      </span>
                                    </div>
                                  ) : (
                                    <Music className="w-4 h-4 text-gray-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-white truncate">
                                    File {index + 1}
                                  </p>
                                  <p className="text-xs text-gray-400">
                                    {isImage
                                      ? "Image"
                                      : isVideo
                                      ? "Video"
                                      : "Audio"}
                                  </p>
                                </div>
                                {currentMediaIndex === index && (
                                  <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              })()}

            <div className="flex flex-wrap gap-3 min-w-0">
              <Button
                onClick={handleDownload}
                variant="outline"
                size="icon"
                className="h-12 w-12 bg-[#2D2D30] border-gray-600 hover:bg-[#3D3D40] text-white rounded-lg"
              >
                <Download className="h-5 w-5" />
              </Button>
              <Button
                onClick={handleShare}
                variant="outline"
                size="icon"
                className="h-12 w-12 bg-[#2D2D30] border-gray-600 hover:bg-[#3D3D40] text-white rounded-lg"
              >
                <Share2 className="h-5 w-5" />
              </Button>
              <Button
                onClick={() => setIsAuditTrailVisible(true)}
                variant="outline"
                size="icon"
                className={`h-12 w-12 border-gray-600 rounded-lg transition-colors ${
                  isAuditTrailVisible
                    ? "bg-blue-600 hover:bg-blue-700 text-white"
                    : "bg-[#2D2D30] hover:bg-[#3D3D40] text-gray-400"
                }`}
                disabled={!tag.audit_trail_id || isAuditTrailFetching}
                title={
                  !tag.audit_trail_id
                    ? "No Audit Trail Available"
                    : isAuditTrailFetching
                    ? "Loading Audit Trail..."
                    : "View Audit Trail"
                }
              >
                <Info className="h-5 w-5" />
              </Button>
              {isOwner && (
                <Button
                  onClick={handleDeregister}
                  variant="destructive"
                  size="icon"
                  className="h-12 w-12 bg-red-800/50 border-red-500/60 hover:bg-red-700/50 text-red-300 rounded-lg"
                  disabled={isProcessing}
                >
                  {isDeregistering ? (
                    <div className="w-5 h-5 border-2 border-white/50 border-t-white rounded-full animate-spin"></div>
                  ) : (
                    <Trash2 className="h-5 w-5" />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <Toaster position="top-right" />
    </main>
  );
}