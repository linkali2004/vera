"use client";

import AuthenticatedLayout from "@/components/custom/layouts/authenticated-layout";
import LoadingModal from "@/components/custom/loading-modal";
import { useAuth } from "@/context/AuthContext";
import { API_BASE_URL } from "@/lib/config";
import { ethers } from "ethers";
import { safeLocalStorageSet, safeLocalStorageGet } from "@/utils/storage";
import {
  ArrowRight,
  Check,
  CheckCircle,
  SearchCheck,
  ShieldAlert,
  UploadCloud,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import toast, { Toaster } from "react-hot-toast";
import { initAuditTrail, logAuditEvent } from "@/utils/audit-utils";

const ABI = [
  "function registerMedia(string memory mediaCid, string memory metadataCid, bytes32 contentHash) public",
  "function getMedia(bytes32 contentHash) public view returns (string memory mediaCid, string memory metadataCid, address uploader, uint256 timestamp)",
  "function getMediaByOwner(address owner) public view returns (bytes32[] memory)",
  "error MediaAlreadyRegistered(bytes32 contentHash)",
  "error MediaNotFound(bytes32 contentHash)",
];

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

function getEthersContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS as string, ABI, signerOrProvider);
}

async function generateContentHash(file: File): Promise<string> {
  try {
    const arrayBuffer = await file.arrayBuffer();

    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const keccakHash = ethers.keccak256("0x" + hashHex);
    return keccakHash;
  } catch (error) {
    console.error("Error generating content hash:", error);
    throw new Error("Failed to generate content hash from file object");
  }
}

interface DetectionResult {
  media_type: string;
  deepfake_probability: number;
  natural_probability: number;
  reasoning: {
    content_analysis: string;
    deepfake_indicators: string;
    authentic_indicators: string;
    overall: string;
  };
  raw_model_output: string;
  sdk_raw: any;
  provided_source: string;
  cloudinary_url: string;
  cloudinary_public_id: string;
}

interface PreparedData {
  name: string;
  description: string;
  mediaType: string;
  filePreview: string;
  detectionResult: DetectionResult;
}

export default function CreateTagPage() {
  const { isAuthorized, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);
  const [bulkResults, setBulkResults] = useState<PreparedData[]>([]);
  const [currentBulkIndex, setCurrentBulkIndex] = useState(0);
  const [bulkProcessingIndex, setBulkProcessingIndex] = useState(-1);

  const [isVerifying, setIsVerifying] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [deepfakeWarning, setDeepfakeWarning] = useState<string | null>(null);
  const [preparedData, setPreparedData] = useState<PreparedData | null>(null);
  const [isHighDeepfakeDetected, setIsHighDeepfakeDetected] = useState(false);
  const [isMediaAlreadyVerified, setIsMediaAlreadyVerified] = useState(false);
  const [loadingModal, setLoadingModal] = useState({
    isVisible: false,
    title: "",
    subtitle: "",
    steps: [] as { text: string; completed: boolean }[],
    progress: 0,
    iconType: "default" as "default" | "download" | "delete" | "verify" | "ai",
  });

  useEffect(() => {
    if (!isAuthLoading && !isAuthorized) {
      router.push("/");
    }
  }, [isAuthorized, isAuthLoading, router]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      if (isBulkMode) {
        processBulkFiles(Array.from(selectedFiles));
      } else {
        const selectedFile = selectedFiles[0];
        if (selectedFile) {
          processFile(selectedFile);
        }
      }
    }
  };

  const processFile = (selectedFile: File) => {
    const validTypes = ["image/", "video/", "audio/"];
    const isValidType = validTypes.some((type) =>
      selectedFile.type.startsWith(type)
    );

    if (!isValidType) {
      toast.error("Please select a valid image, video, or audio file.");
      return;
    }

    setFile(selectedFile);
    setFileName(selectedFile.name);
    setPreparedData(null);
    setDeepfakeWarning(null);
    setIsHighDeepfakeDetected(false);
    setIsVerified(false);
    setIsMediaAlreadyVerified(false);
    
    initAuditTrail(selectedFile.name);
    logAuditEvent("FILE_UPLOAD", "File Selected for Single Upload", "SUCCESS", selectedFile.name);
  };

  const processBulkFiles = (selectedFiles: File[]) => {
    const validTypes = ["image/", "video/", "audio/"];
    const validFiles = selectedFiles.filter((file) =>
      validTypes.some((type) => file.type.startsWith(type))
    );

    if (validFiles.length === 0) {
      toast.error("Please select valid image, video, or audio files.");
      return;
    }

    if (validFiles.length !== selectedFiles.length) {
      toast.error(
        `${
          selectedFiles.length - validFiles.length
        } invalid files were skipped.`
      );
    }

    setBulkFiles(validFiles);
    setBulkResults([]);
    setCurrentBulkIndex(0);
    setBulkProcessingIndex(-1);
    setPreparedData(null);
    setDeepfakeWarning(null);
    setIsHighDeepfakeDetected(false);
    setIsVerified(false);
    
    initAuditTrail(`Bulk_Upload_${Date.now()}`);
    logAuditEvent("FILE_UPLOAD", `Bulk Upload: ${validFiles.length} files selected`, "SUCCESS", `${validFiles.length} files`);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    const files = event.dataTransfer.files;
    if (files && files.length > 0) {
      if (isBulkMode) {
        processBulkFiles(Array.from(files));
      } else {
        const droppedFile = files[0];
        processFile(droppedFile);
      }
    }
  };

  const handleVerifyOnChain = async () => {
    if (!file) return toast.error("Please select a file first.");
    if (typeof window.ethereum === "undefined")
      return toast.error("MetaMask is not installed.");

    setIsVerifying(true);
    setIsVerified(false);

    setLoadingModal({
      isVisible: true,
      title: "Verifying Uniqueness",
      subtitle: "Checking blockchain for duplicate media...",
      steps: [
        { text: "Generating content hash", completed: false },
        { text: "Connecting to blockchain", completed: false },
        { text: "Checking for duplicates", completed: false },
        { text: "Verification complete", completed: false },
      ],
      progress: 0,
      iconType: "verify",
    });

    logAuditEvent("ON_CHAIN_CHECK", "Starting Uniqueness Verification", "PENDING", file.name);

    try {
      setLoadingModal((prev) => ({
        ...prev,
        progress: 25,
        steps: prev.steps.map((step, index) =>
          index === 0 ? { ...step, completed: true } : step
        ),
      }));

      const contentHash = await generateContentHash(file);
      logAuditEvent("ON_CHAIN_CHECK", "Content Hash Generated (SHA256+Keccak)", "SUCCESS", contentHash);

      console.log("Content hash:", contentHash);
      setLoadingModal((prev) => ({
        ...prev,
        progress: 50,
        steps: prev.steps.map((step, index) =>
          index === 1 ? { ...step, completed: true } : step
        ),
      }));

      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = getEthersContract(provider);

      setLoadingModal((prev) => ({
        ...prev,
        progress: 75,
        steps: prev.steps.map((step, index) =>
          index === 2 ? { ...step, completed: true } : step
        ),
      }));

      try {
        const mediaData = await contract.getMedia(contentHash);
        
        console.log("Duplicate found:", mediaData);
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        setIsMediaAlreadyVerified(true);
        toast.error(
          "This media has already been registered on the blockchain."
        );
        logAuditEvent("ON_CHAIN_CHECK", "Verification Failed (Duplicate)", "ERROR", `Registered by ${mediaData[2]}`);
        return;
      } catch (error: any) {
        console.log("Uniqueness check result:", error.message);
        if (
          error.code === "CALL_EXCEPTION" ||
          error.code === "BAD_DATA" ||
          error.message?.includes("MediaNotFound") ||
          error.message?.includes("execution reverted")
        ) {
          
        } else {
          throw error;
        }

        setLoadingModal((prev) => ({
          ...prev,
          progress: 100,
          steps: prev.steps.map((step, index) =>
            index === 3 ? { ...step, completed: true } : step
          ),
        }));

        toast.success("This media is unique. You can now detect deepfakes.");
        setIsVerified(true);
        logAuditEvent("ON_CHAIN_CHECK", "Verification Success (Unique)", "SUCCESS", "Ready for AI Analysis");


        setTimeout(() => {
          setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        }, 1000);
      }
    } catch (err: any) {
      toast.error(
        err.message || "An unexpected error occurred during verification."
      );
      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      logAuditEvent("ON_CHAIN_CHECK", "Verification Failed", "ERROR", String(err.message));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBulkVerifyOnChain = async () => {
    if (bulkFiles.length === 0)
      return toast.error("Please select files first.");
    if (typeof window.ethereum === "undefined")
      return toast.error("MetaMask is not installed.");

    setIsVerifying(true);
    setIsVerified(false);

    setLoadingModal({
      isVisible: true,
      title: "Verifying Uniqueness (Bulk)",
      subtitle: "Checking blockchain for duplicate media...",
      steps: [
        { text: "Generating file hashes", completed: false },
        { text: "Connecting to blockchain", completed: false },
        { text: "Checking for duplicates", completed: false },
        { text: "Verification complete", completed: false },
      ],
      progress: 0,
      iconType: "verify",
    });
    
    logAuditEvent("ON_CHAIN_CHECK", "Starting Bulk Uniqueness Verification", "PENDING", `${bulkFiles.length} files`);

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const contract = getEthersContract(provider);
      const validFiles: File[] = [];
      let duplicateCount = 0;

      for (let i = 0; i < bulkFiles.length; i++) {
        const currentFile = bulkFiles[i];

        const progress = ((i + 1) / bulkFiles.length) * 100;
        setLoadingModal((prev) => ({
          ...prev,
          progress: progress,
          subtitle: `Checking file ${i + 1} of ${bulkFiles.length}: ${
            currentFile.name
          }`,
          steps: prev.steps.map((step, index) => {
            if (index === 0 && i === 0) return { ...step, completed: true };
            if (index === 1 && i === 0) return { ...step, completed: true };
            if (index === 2 && i < bulkFiles.length)
              return { ...step, completed: true };
            if (index === 3 && i === bulkFiles.length - 1)
              return { ...step, completed: true };
            return step;
          }),
        }));

        try {
          const contentHash = await generateContentHash(currentFile);
          console.log(
            `Checking uniqueness for ${currentFile.name} with hash: ${contentHash}`
          );

          try {
            const mediaData = await contract.getMedia(contentHash);
            
            console.log(`Duplicate found for ${currentFile.name}:`, mediaData);
            toast.error(
              `File "${currentFile.name}" has already been registered on the blockchain.`
            );
            duplicateCount++;
          } catch (error: any) {
            console.log(
              `Uniqueness check for ${currentFile.name}:`,
              error.message
            );
            if (
              error.code === "CALL_EXCEPTION" ||
              error.code === "BAD_DATA" ||
              error.message?.includes("MediaNotFound") ||
              error.message?.includes("execution reverted")
            ) {
              console.log(`File ${currentFile.name} is unique`);
              validFiles.push(currentFile);
            } else {
              console.error(
                `Unexpected error checking ${currentFile.name}:`,
                error
              );
              throw error;
            }
          }
        } catch (error: any) {
          console.error(`Error verifying ${currentFile.name}:`, error);
          toast.error(`Failed to verify ${currentFile.name}: ${error.message}`);
        }
      }

      setBulkFiles(validFiles);

      if (validFiles.length === 0) {
        toast.error(
          "All files have already been registered on the blockchain."
        );
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        logAuditEvent("ON_CHAIN_CHECK", "Bulk Verification Failed (All Duplicates)", "ERROR", `Duplicates: ${duplicateCount}`);
        return;
      }

      if (validFiles.length !== bulkFiles.length) {
        toast.success(
          `${validFiles.length} out of ${bulkFiles.length} files are unique and can proceed.`
        );
      } else {
        toast.success("All files are unique. You can now detect deepfakes.");
      }

      setIsVerified(true);
      logAuditEvent("ON_CHAIN_CHECK", "Bulk Verification Success (Unique Files)", "SUCCESS", `${validFiles.length} files proceeded. Duplicates: ${duplicateCount}`);


      setTimeout(() => {
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      }, 1000);
    } catch (err: any) {
      toast.error(
        err.message || "An unexpected error occurred during verification."
      );
      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      logAuditEvent("ON_CHAIN_CHECK", "Bulk Verification Failed", "ERROR", String(err.message));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBulkAnalysis = async () => {
    if (bulkFiles.length === 0)
      return toast.error("Please select files to analyze.");
    if (!isVerified)
      return toast.error("Please verify the files' uniqueness on-chain first.");

    setIsDetecting(true);
    setBulkResults([]);
    setBulkProcessingIndex(0);
    setDeepfakeWarning(null);
    setIsHighDeepfakeDetected(false);

    setLoadingModal({
      isVisible: true,
      title: "Analyzing Multiple Files",
      subtitle: `Processing ${bulkFiles.length} files...`,
      steps: [
        { text: "Preparing files for analysis", completed: false },
        { text: "Running AI analysis on each file", completed: false },
        { text: "Generating detailed reports", completed: false },
        { text: "Analysis complete", completed: false },
      ],
      progress: 0,
      iconType: "ai",
    });
    
    logAuditEvent("AI_VERIFICATION", "Starting Bulk AI Analysis", "PENDING", `${bulkFiles.length} files`);

    try {
      const results: PreparedData[] = [];
      let successCount = 0;
      let rejectionCount = 0;

      for (let i = 0; i < bulkFiles.length; i++) {
        const currentFile = bulkFiles[i];
        setBulkProcessingIndex(i);

        const progress = ((i + 1) / bulkFiles.length) * 100;
        setLoadingModal((prev) => ({
          ...prev,
          progress: progress,
          subtitle: `Processing file ${i + 1} of ${bulkFiles.length}: ${
            currentFile.name
          }`,
          steps: prev.steps.map((step, index) => {
            if (index === 0 && i === 0) return { ...step, completed: true };
            if (index === 1 && i < bulkFiles.length)
              return { ...step, completed: true };
            if (index === 2 && i === bulkFiles.length - 1)
              return { ...step, completed: true };
            if (index === 3 && i === bulkFiles.length - 1)
              return { ...step, completed: true };
            return step;
          }),
        }));

        try {
          const formData = new FormData();
          formData.append("file_data", currentFile);

          const response = await fetch(`${API_BASE_URL}/api/detect`, {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Detection failed for ${currentFile.name}: ${errorText}`
            );
          }

          const detectionResult: DetectionResult = await response.json();

          const createOptimizedPreview = async (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                if (result.length > 100000) {
                  const canvas = document.createElement('canvas');
                  const ctx = canvas.getContext('2d');
                  const img = new Image();
                  
                  img.onload = () => {
                    const maxSize = 200;
                    let { width, height } = img;
                    
                    if (width > height) {
                      if (width > maxSize) {
                        height = (height * maxSize) / width;
                        width = maxSize;
                      }
                    } else {
                      if (height > maxSize) {
                        width = (width * maxSize) / height;
                        height = maxSize;
                      }
                      
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    ctx?.drawImage(img, 0, 0, width, height);
                    
                    const compressedPreview = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(compressedPreview);
                  };
                  
                  img.onerror = () => {
                    resolve('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbSIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lZGlhIFByZXZpZXc8L3RleHQ+PC9zdmc+');
                  };
                  
                  img.src = result;
                } else {
                  resolve(result);
                }
              };
              reader.onerror = (error) => reject(error);
              reader.readAsDataURL(file);
            });
          };

          const optimizedPreview = await createOptimizedPreview(currentFile);
          const tagDataPayload: PreparedData = {
            name: currentFile.name,
            description: description || "",
            mediaType: currentFile.type.split("/")[0] || "image",
            filePreview: optimizedPreview,
            detectionResult: detectionResult,
          };

          results.push(tagDataPayload);

          const isFake = detectionResult.deepfake_probability >= 50;

          if (isFake) {
            toast.error(
              `Fake content detected in ${currentFile.name} (Deepfake: ${detectionResult.deepfake_probability}%) - excluded`
            );
            rejectionCount++;
          } else {
            successCount++;
          }
        } catch (error: any) {
          console.error(`Error processing ${currentFile.name}:`, error);
          toast.error(
            `Failed to analyze ${currentFile.name}: ${error.message}`
          );
        }
      }

      setBulkResults(results);
      setCurrentBulkIndex(0);

      const naturalImages = results.filter(
        (result) => result.detectionResult.deepfake_probability < 50
      );

      if (results.length === 0) {
        toast.error("Failed to analyze any files. Please try again.");
        logAuditEvent("AI_VERIFICATION", "Bulk Analysis Failed (No results)", "ERROR", `Total files: ${bulkFiles.length}`);
      } else if (naturalImages.length === 0) {
        toast.error(
          "All files detected as potential deepfakes. Please try different files."
        );
        logAuditEvent("AI_VERIFICATION", "Bulk Analysis Failed (All Rejected)", "ERROR", `Rejected: ${rejectionCount}`);
      } else {
        toast.success(
          `Analysis complete! ${naturalImages.length} out of ${results.length} files are original and will proceed to registration.`
        );
        logAuditEvent("AI_VERIFICATION", "Bulk Analysis Complete", "SUCCESS", `Original: ${successCount}, Rejected: ${rejectionCount}`);
      }

      setTimeout(() => {
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      }, 1000);
    } catch (err: any) {
      console.error("Bulk analysis error:", err);
      toast.error(err.message || "Could not analyze the files.");
      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      logAuditEvent("AI_VERIFICATION", "Bulk Analysis Unexpected Error", "ERROR", String(err.message));
    } finally {
      setIsDetecting(false);
      setBulkProcessingIndex(-1);
    }
  };

  const handleAnalysis = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) return toast.error("Please select a file to analyze.");
    if (!isVerified)
      return toast.error("Please verify the file's uniqueness on-chain first.");

    setIsDetecting(true);
    setDeepfakeWarning(null);
    setPreparedData(null);
    setIsHighDeepfakeDetected(false);

    setLoadingModal({
      isVisible: true,
      title: "Analyzing Media",
      subtitle: "Detecting deepfake indicators...",
      steps: [
        { text: "Uploading media to secure servers", completed: false },
        { text: "Running AI analysis algorithms", completed: false },
        { text: "Verifying authenticity markers", completed: false },
        { text: "Generating detailed report", completed: false },
      ],
      progress: 0,
      iconType: "ai",
    });
    
    logAuditEvent("AI_VERIFICATION", "Starting Single AI Analysis", "PENDING", file.name);

    try {
      setLoadingModal((prev) => ({
        ...prev,
        progress: 25,
        steps: prev.steps.map((step, index) =>
          index === 0 ? { ...step, completed: true } : step
        ),
      }));

      const formData = new FormData();
      formData.append("file_data", file);

      setLoadingModal((prev) => ({
        ...prev,
        progress: 50,
        steps: prev.steps.map((step, index) =>
          index === 1 ? { ...step, completed: true } : step
        ),
      }));

      const response = await fetch(`${API_BASE_URL}/api/detect`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Detection service failed: ${errorText}`);
      }
      const detectionResult: DetectionResult = await response.json();
      logAuditEvent("AI_VERIFICATION", "AI Detection Received", "SUCCESS", `Deepfake: ${detectionResult.deepfake_probability}%`);

      setLoadingModal((prev) => ({
        ...prev,
        progress: 75,
        steps: prev.steps.map((step, index) =>
          index === 2 ? { ...step, completed: true } : step
        ),
      }));

      if (typeof window.ethereum !== "undefined") {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const signerAddress = await signer.getAddress();
        const metadataObject = {
          fileName: fileName,
          description: description,
          signerAddress: signerAddress,
          probabilities: {
            deepfake: detectionResult.deepfake_probability,
            natural: detectionResult.natural_probability,
          },
          contentAnalysis: detectionResult.reasoning.content_analysis,
          authenticIndicators: detectionResult.reasoning.authentic_indicators,
          deepfakeIndicators: detectionResult.reasoning.deepfake_indicators,
        };
        localStorage.setItem(
          "metadata",
          JSON.stringify(metadataObject, null, 2)
        );
      } else {
        toast.error(
          "MetaMask not found. Metadata could not be saved with a signer address."
        );
      }

      const naturalProbability = detectionResult.natural_probability;
      
      if (naturalProbability <= 50) {
        setIsHighDeepfakeDetected(true);
        setDeepfakeWarning(
          `SYNTHETIC content detected (${naturalProbability}% natural). Please try another media file.`
        );
        toast.error(
          "SYNTHETIC content detected. Please try another media file."
        );
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        logAuditEvent("AI_VERIFICATION", "Analysis Failed (SYNTHETIC)", "ERROR", `Natural Prob: ${naturalProbability}%`);
        return;
      } else if (naturalProbability < 70) {
        setDeepfakeWarning(
          `INCONCLUSIVE: AI analysis indicates moderate uncertainty (${naturalProbability}% natural).`
        );
      }

      const createOptimizedPreview = async (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            if (result.length > 100000) {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              const img = new Image();
              
              img.onload = () => {
                const maxSize = 200;
                let { width, height } = img;
                
                if (width > height) {
                  if (width > maxSize) {
                    height = (height * maxSize) / width;
                    width = maxSize;
                  }
                } else {
                  if (height > maxSize) {
                    width = (width * maxSize) / height;
                    height = maxSize;
                  }
                }
                
                canvas.width = width;
                canvas.height = height;
                ctx?.drawImage(img, 0, 0, width, height);
                
                const compressedPreview = canvas.toDataURL('image/jpeg', 0.7);
                resolve(compressedPreview);
              };
              
              img.onerror = () => {
                resolve('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjY2NjIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbSIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPk1lZGlhIFByZXZpZXc8L2hlYWQ+PC9zdmc+');
              };
              
              img.src = result;
            } else {
              resolve(result);
            }
          };
          reader.onerror = (error) => reject(error);
          reader.readAsDataURL(file);
        });
      };

      const optimizedPreview = await createOptimizedPreview(file);
      const tagDataPayload: PreparedData = {
        name: fileName,
        description: description || "",
        mediaType: file.type.split("/")[0] || "image",
        filePreview: optimizedPreview,
        detectionResult: detectionResult,
      };

      const storageSuccess = await safeLocalStorageSet("uploadedTagData", tagDataPayload, {
        fallbackToSession: true,
        compressData: true
      });
      
      if (!storageSuccess) {
        toast.error("Unable to save data. Please try with a smaller file or clear your browser storage.");
        logAuditEvent("DB_UPLOAD", "Local Storage Failed", "ERROR", "Storage quota exceeded or compression failed.");
        return;
      }
      setPreparedData(tagDataPayload);

      setLoadingModal((prev) => ({
        ...prev,
        progress: 100,
        steps: prev.steps.map((step, index) =>
          index === 3 ? { ...step, completed: true } : step
        ),
      }));

      toast.success("Analysis complete. You can now proceed to register.");
      logAuditEvent("AI_VERIFICATION", "Analysis Complete (Proceed to Review)", "SUCCESS", "Data prepared for review.");


      setTimeout(() => {
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      }, 1000);
    } catch (err: any) {
      console.error("Detection error:", err);
      toast.error(err.message || "Could not analyze the media.");
      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      logAuditEvent("AI_VERIFICATION", "Analysis Failed", "ERROR", String(err.message));
    } finally {
      setIsDetecting(false);
    }
  };

  const handleCancel = () => {
    router.push("/");
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  if (!isAuthorized) {
    router.push("/login");
    return null;
  }

  const isProcessing = isDetecting || isVerifying;

  return (
    <AuthenticatedLayout>
      <LoadingModal
        isVisible={loadingModal.isVisible}
        title={loadingModal.title}
        subtitle={loadingModal.subtitle}
        steps={loadingModal.steps}
        progress={loadingModal.progress}
        showSecurityNote={true}
        iconType={loadingModal.iconType}
      />

      {isMediaAlreadyVerified && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-300">
          <div className="bg-[#2A2D35] border border-[#3A3D45] rounded-2xl p-8 max-w-md mx-4 text-center shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
              <CheckCircle className="w-10 h-10 text-green-400" />
            </div>
            <h3 className="text-2xl font-bold text-white mb-4">
              Media is already Verafied
            </h3>
            <p className="text-gray-300 mb-6 leading-relaxed">
              This media has already been registered on the blockchain and
              verafied for authenticity.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => {
                  setIsMediaAlreadyVerified(false);
                  setFile(null);
                  setFileName("");
                  setDescription("");
                  setPreparedData(null);
                  setDeepfakeWarning(null);
                  setIsHighDeepfakeDetected(false);
                  setIsVerified(false);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Try Another Media
              </button>
              <button
                onClick={() => setIsMediaAlreadyVerified(false)}
                className="w-full bg-gray-600 hover:bg-gray-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <main className="min-h-screen bg-[#181A1D]">
        <button
          onClick={handleCancel}
          className="fixed top-20 right-4 w-10 h-10 bg-[#3A3D45] rounded-lg flex items-center justify-center hover:bg-[#4A4D55] transition-colors z-40"
        >
          <X className="w-5 h-5 text-white" />
        </button>

        <div className="container mx-auto px-4 py-8">
          <div className="flex justify-center items-center mb-12">
            <div className="flex items-center space-x-8">
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg bg-blue-600">
                  <span className="font-bold text-lg text-white">1</span>
                </div>
                <span className="text-white text-sm mt-3 font-medium">
                  Add & Analyze Media
                </span>
              </div>
              <div className="w-16 h-0.5 bg-gray-600"></div>
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg bg-white border-2 border-blue-600">
                  <span className="font-bold text-lg text-blue-600">2</span>
                </div>
                <span className="text-white text-sm mt-3 font-medium">
                  Review & Register
                </span>
              </div>
            </div>
          </div>

          <div className="max-w-2xl mx-auto">
            <form
              onSubmit={handleAnalysis}
              className="bg-[#2A2D35] p-8 rounded-lg border border-[#3A3D45] space-y-6"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-300">
                    Upload Media
                  </label>
                  <div className="flex items-center space-x-3">
                    <span className="text-xs text-gray-400">Single</span>
                    <button
                      onClick={() => {
                        setIsBulkMode(!isBulkMode);
                        if (!isBulkMode) {
                          setBulkFiles([]);
                          setBulkResults([]);
                          setCurrentBulkIndex(0);
                          setBulkProcessingIndex(-1);
                        } else {
                          setFile(null);
                          setFileName("");
                          setDescription("");
                          setPreparedData(null);
                          setDeepfakeWarning(null);
                          setIsHighDeepfakeDetected(false);
                          setIsVerified(false);
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 ${
                        isBulkMode ? "bg-blue-600" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isBulkMode ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                    <span className="text-xs text-gray-400">Bulk</span>
                  </div>
                </div>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-all duration-200 ${
                    isDragOver
                      ? "border-blue-500 bg-blue-500/10 scale-[1.02]"
                      : "border-gray-600 hover:border-blue-500"
                  }`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                    accept="image/*,video/*,audio/*"
                    multiple={isBulkMode}
                  />
                  <div
                    className={`mx-auto w-12 h-12 rounded-full flex items-center justify-center transition-all duration-200 ${
                      isDragOver ? "bg-blue-500/20 scale-110" : "bg-gray-700"
                    }`}
                  >
                    <UploadCloud
                      className={`w-6 h-6 transition-colors duration-200 ${
                        isDragOver ? "text-blue-400" : "text-gray-400"
                      }`}
                    />
                  </div>
                  {isBulkMode ? (
                    bulkFiles.length > 0 ? (
                      <p className="mt-2 text-sm text-green-400">
                        {bulkFiles.length} file{bulkFiles.length > 1 ? "s" : ""}{" "}
                        selected
                      </p>
                    ) : isDragOver ? (
                      <p className="mt-2 text-sm text-blue-400 font-medium">
                        Drop your files here
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-gray-400">
                        Click to browse or drag & drop multiple files here
                      </p>
                    )
                  ) : file ? (
                    <p
                      className="mt-2 text-sm text-green-400 truncate max-w-full"
                      title={file.name}
                    >
                      {file.name.length > 30
                        ? file.name.substring(0, 30) + "..."
                        : file.name}{" "}
                      selected
                    </p>
                  ) : isDragOver ? (
                    <p className="mt-2 text-sm text-blue-400 font-medium">
                      Drop your file here
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-gray-400">
                      Click to browse or drag & drop your file here
                    </p>
                  )}
                </div>
              </div>
              <div>
                <label
                  htmlFor="fileName"
                  className="text-sm font-medium text-gray-300 mb-2 block"
                >
                  {isBulkMode ? "Collection Name" : "Media Name"}
                </label>
                <input
                  type="text"
                  id="fileName"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder={
                    isBulkMode
                      ? "e.g., My Photo Collection"
                      : "e.g., My Summer Vacation Video"
                  }
                  className="w-full bg-[#3A3D45] border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="description"
                  className="text-sm font-medium text-gray-300 mb-2 block"
                >
                  Description (Optional)
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="A short description of your media file..."
                  rows={3}
                  className="w-full bg-[#3A3D45] border border-gray-600 text-white rounded-md px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {isBulkMode ? (
                <div className="flex items-center space-x-4">
                  <button
                    type="button"
                    onClick={handleBulkVerifyOnChain}
                    disabled={
                      bulkFiles.length === 0 || isProcessing || isVerified
                    }
                    className="w-full font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition-all duration-300 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-600"
                  >
                    {isVerified ? (
                      <Check className="w-5 h-5 mr-2" />
                    ) : (
                      <SearchCheck className="w-5 h-5 mr-2" />
                    )}
                    {isVerifying
                      ? "Verifying..."
                      : isVerified
                      ? "Verified"
                      : "1. Verify Uniqueness"}
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkAnalysis}
                    disabled={!isVerified || isProcessing}
                    className="w-full font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition-all duration-300 disabled:cursor-not-allowed bg-gray-700 text-white hover:bg-gray-800 disabled:bg-gray-600"
                  >
                    <ShieldAlert className="w-5 h-5 mr-2" />
                    {isDetecting ? "Analyzing..." : "2. Detect Deepfake"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center space-x-4">
                  <button
                    type="button"
                    onClick={handleVerifyOnChain}
                    disabled={!file || isProcessing || isVerified}
                    className="w-full font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition-all duration-300 disabled:cursor-not-allowed bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-600"
                    >
                    {isVerified ? (
                      <Check className="w-5 h-5 mr-2" />
                    ) : (
                      <SearchCheck className="w-5 h-5 mr-2" />
                    )}
                    {isVerifying
                      ? "Verifying..."
                      : isVerified
                      ? "Verified"
                      : "1. Verify Uniqueness"}
                  </button>
                  <button
                    type="submit"
                    disabled={!isVerified || isProcessing || !!preparedData}
                    className="w-full font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition-all duration-300 disabled:cursor-not-allowed bg-gray-700 text-white hover:bg-gray-800 disabled:bg-gray-600"
                  >
                    <ShieldAlert className="w-5 h-5 mr-2" />
                    {isDetecting
                      ? "Analyzing..."
                      : preparedData
                      ? "Analysis Complete"
                      : "2. Detect Deepfake"}
                  </button>
                </div>
              )}
            </form>
          </div>

          {deepfakeWarning && (
            <div
              className={`max-w-2xl mx-auto mt-6 p-4 border rounded-lg flex items-start space-x-4 ${
                isHighDeepfakeDetected
                  ? "bg-red-900/50 border-red-500/60"
                  : "bg-yellow-900/50 border-yellow-500/60"
              }`}
            >
              <ShieldAlert
                className={`w-6 h-6 flex-shrink-0 mt-1 ${
                  isHighDeepfakeDetected ? "text-red-400" : "text-yellow-400"
                }`}
              />
              <div>
                <h4
                  className={`font-bold mt-1 ${
                    isHighDeepfakeDetected ? "text-red-300" : "text-yellow-300"
                  }`}
                >
                  {isHighDeepfakeDetected
                    ? "Deepfake Detected - Upload Blocked"
                    : "Moderate Deepfake Risk"}
                </h4>
                <p
                  className={`text-sm mt-1 ${
                    isHighDeepfakeDetected
                      ? "text-red-300/80"
                      : "text-yellow-300/80"
                  }`}
                >
                  {deepfakeWarning}
                </p>
                {isHighDeepfakeDetected && (
                  <div className="mt-3">
                    <button
                      onClick={() => {
                        setFile(null);
                        setFileName("");
                        setDescription("");
                        setPreparedData(null);
                        setDeepfakeWarning(null);
                        setIsHighDeepfakeDetected(false);
                        setIsVerified(false);
                        setIsMediaAlreadyVerified(false);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      Try Another Media
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {preparedData && !isDetecting && !isHighDeepfakeDetected && (
            <div className="max-w-2xl mx-auto mt-6 p-4 bg-green-900/50 border border-green-500/60 rounded-lg flex items-center space-x-4">
              <CheckCircle className="w-6 h-6 text-green-400 flex-shrink-0" />
              <p className="text-sm text-green-300 font-medium">
                Analysis complete. You can now proceed to register the media.
              </p>
            </div>
          )}

          {!isHighDeepfakeDetected && (
            <div className="max-w-2xl mx-auto mt-6">
              <button
                onClick={async () => {
                  if (isBulkMode) {
                    if (bulkResults.length > 0) {
                      const compressedData = {
                        collectionName: fileName || "My Collection",
                        collectionDescription: description || "",
                        files: bulkResults.map((result) => ({
                          name: result.name,
                          description: result.description,
                          mediaType: result.mediaType,
                          detectionResult: {
                            media_type: result.detectionResult.media_type,
                            deepfake_probability:
                              result.detectionResult.deepfake_probability,
                            natural_probability:
                              result.detectionResult.natural_probability,
                            reasoning: result.detectionResult.reasoning,
                            cloudinary_url:
                              result.detectionResult.cloudinary_url,
                            cloudinary_public_id:
                              result.detectionResult.cloudinary_public_id,
                          },
                        })),
                      };

                      const storageSuccess = await safeLocalStorageSet("bulkUploadData", compressedData, {
                        fallbackToSession: true,
                        compressData: true
                      });
                      
                      if (storageSuccess) {
                        router.push("/review-tag");
                      } else {
                        toast.error("Storage quota exceeded. Please try with fewer files or clear your browser storage.");
                      }
                    } else {
                      toast.error(
                        "No files analyzed. Please run analysis first."
                      );
                    }
                  } else {
                    router.push("/review-tag");
                  }
                }}
                disabled={
                  isBulkMode
                    ? bulkResults.length === 0
                    : !preparedData || isProcessing
                }
                className={`w-full font-semibold py-3 px-6 rounded-lg flex items-center justify-center transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] ${
                  (isBulkMode ? bulkResults.length === 0 : !preparedData) ||
                  isProcessing
                    ? "bg-gray-600 text-gray-400 cursor-not-allowed"
                    : "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white shadow-lg hover:shadow-xl hover:shadow-green-500/25"
                }`}
              >
                <span>
                  {isBulkMode ? "Review Analysis Results" : "Register on Chain"}
                </span>
                <ArrowRight className="w-5 h-5 ml-2" />
              </button>
            </div>
          )}
        </div>
      </main>
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "#2A2D35",
            color: "#fff",
            border: "1px solid #3A3D45",
          },
        }}
      />
    </AuthenticatedLayout>
  );
}