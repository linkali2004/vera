// @ts-nocheck
"use client";

import LoadingModal from "@/components/custom/loading-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_ENDPOINTS } from "@/lib/config";
import { MetaMaskInpageProvider } from "@metamask/providers";
import { ethers, type TransactionResponse } from "ethers";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  RefreshCw,
  Wallet,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { logAuditEvent, getAuditTrail, clearAuditTrail } from "@/utils/audit-utils";

declare global {
  var window: Window & {
    ethereum?: MetaMaskInpageProvider;
  };
}

const ABI = [
  "function registerMedia(string memory mediaCid, string memory metadataCid, bytes32 contentHash) public",
  "function getMedia(bytes32 contentHash) public view returns (string memory mediaCid, string memory metadataCid, address uploader, uint256 timestamp)",
  "function getMediaByOwner(address owner) public view returns (bytes32[] memory)",
  "error MediaAlreadyRegistered(bytes32 contentHash)",
  "error MediaNotFound(bytes32 contentHash)",
];

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;

function base64ToFile(base64: string, fileName: string): File {
  const arr = base64.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch)
    throw new Error("Invalid Base64 string: MIME type not found.");
  const mime = mimeMatch[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], fileName, { type: mime });
}

async function uploadFileToPinata(file: File): Promise<string> {
  const data = new FormData();
  data.append("file", file);

  const PINATA_JWT = process.env.NEXT_PUBLIC_PINATA_JWT;

  const res = await fetch("https://api.pinata.cloud/pinning/pinFileToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`,
    },
    body: data,
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(
      `Failed to upload to Pinata: ${res.statusText} - ${errorBody}`
    );
  }
  const result = await res.json();
  if (!result.IpfsHash)
    throw new Error("Invalid response from Pinata: IPFS hash not found.");
  return result.IpfsHash;
}

async function generateSha256Hash(file: File): Promise<string> {
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
function getEthersContract(signerOrProvider: ethers.Signer | ethers.Provider) {
  return new ethers.Contract(CONTRACT_ADDRESS as string, ABI, signerOrProvider);
}

function getCategoricalProbabilities(authenticProbability: number, detectionResult?: any) {
  const displayAuthentic = detectionResult?.natural_probability || authenticProbability;
  const displayDeepfake = detectionResult?.deepfake_probability || (100 - authenticProbability);
  
  let status: string;
  if (displayAuthentic >= 90) {
    status = "AUTHENTIC";
  } else if (displayAuthentic >= 70) {
    status = "INCONCLUSIVE";
  } else {
    status = "SYNTHETIC";
  }

  return {
    displayAuthentic,
    displayDeepfake,
    status,
    originalAuthentic: authenticProbability,
    originalDeepfake: 100 - authenticProbability
  };
}

export default function ReviewTagModal({
  onCancel,
  isBulkUpload = false,
  fileCount = 1,
  collectionName = "My Media",
  fileName: defaultFileName = "My Media",
  description = "A sample media description",
  mediaType: defaultMediaType = "image",
}: {
  onCancel?: () => void;
  isBulkUpload?: boolean;
  fileCount?: number;
  collectionName?: string;
  fileName?: string;
  description?: string;
  mediaType?: string;
}) {
  const router = useRouter();
  const [isRegistering, setIsRegistering] = useState(false);
  const [gasFee, setGasFee] = useState<string>("0");
  const [gasPrice, setGasPrice] = useState<string>("0");
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [ethPrice, setEthPrice] = useState<number>(0);
  const [gasPriceSource, setGasPriceSource] = useState<string>("Etherscan");
  const [networkInfo, setNetworkInfo] = useState<{
    name: string;
    chainId: string;
  }>({ name: "Sepolia Testnet", chainId: "0xaa36a7" });
  const [loadingModal, setLoadingModal] = useState({
    isVisible: false,
    title: "",
    subtitle: "",
    steps: [] as { text: string; completed: boolean }[],
    progress: 0,
  });

  const [bulkData, setBulkData] = useState<any[]>([]);
  const [currentBulkIndex, setCurrentBulkIndex] = useState(0);
  const [isBulkMode, setIsBulkMode] = useState(false);

  const fetchEthPrice = async () => {
    setEthPrice(0);
  };

  const getNetworkInfo = async () => {
    if (typeof window.ethereum === "undefined") return;

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();

      const networkNames: { [key: string]: string } = {
        "0xaa36a7": "Sepolia Testnet",
        "0x1": "Ethereum Mainnet",
        "0x5": "Goerli Testnet",
        "0x89": "Polygon Mainnet",
        "0x13881": "Polygon Mumbai Testnet",
      };

      const chainId = `0x${network.chainId.toString(16)}`;
      const networkName =
        networkNames[chainId] || `Chain ID: ${network.chainId}`;

      setNetworkInfo({
        name: networkName,
        chainId: chainId,
      });
    } catch (error) {
      console.error("Error getting network info:", error);
    }
  };

  const getGasPriceFromEtherscan = async () => {
    try {
      const response = await fetch(
        "https://api-sepolia.etherscan.io/api?module=gastracker&action=gasoracle"
      );
      const data = await response.json();

      if (data.status === "1" && data.result) {
        const safeGasPrice = data.result.SafeGasPrice;
        console.log("Etherscan gas prices:", data.result);
        setGasPriceSource("Etherscan Sepolia");
        return ethers.parseUnits(safeGasPrice, "gwei");
      }
    } catch (error) {
      console.error("Error fetching gas price from Etherscan:", error);
    }
    setGasPriceSource("Default");
    return ethers.parseUnits("20", "gwei");
  };

  const estimateGasFees = async () => {
    if (typeof window?.ethereum === "undefined") {
      setGasPrice("20");
      setGasFee("0.001");
      return;
    }

    setIsLoadingFees(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = getEthersContract(signer);

      const currentGasPrice = await getGasPriceFromEtherscan();
      setGasPrice(ethers.formatUnits(currentGasPrice, "gwei"));

      const dummyCid = "Qmaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const dummyHash = "0x" + "0".repeat(64);

      const gasEstimate = await contract.registerMedia.estimateGas(
        dummyCid,
        dummyCid,
        dummyHash
      );

      const estimatedFee = gasEstimate * currentGasPrice;
      setGasFee(ethers.formatEther(estimatedFee));
    } catch (error) {
      console.error("Error estimating gas fees:", error);
      setGasPrice("20");
      setGasFee("0.001");
    } finally {
      setIsLoadingFees(false);
    }
  };

  useEffect(() => {
    estimateGasFees();
    fetchEthPrice();
    getNetworkInfo();
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const bulkDataRaw =
        localStorage.getItem("bulkUploadData") ||
        sessionStorage.getItem("bulkUploadData");
      if (bulkDataRaw) {
        try {
          const bulkData = JSON.parse(bulkDataRaw);
          setBulkData(bulkData);
          setIsBulkMode(true);
        } catch (error) {
          console.error("Error parsing bulk upload data:", error);
        }
      } else {
        const storedData = localStorage.getItem("uploadedTagData");
        if (storedData) {
          try {
            setTagData(JSON.parse(storedData));
          } catch (error) {
            console.error("Error parsing stored tag data:", error);
          }
        }
      }
    }
  }, []);

  const handleRegister = async () => {
    if (typeof window === "undefined") {
      return toast.error("This function can only be called in the browser.");
    }

    if (isBulkMode) {
      const bulkDataRaw =
        localStorage.getItem("bulkUploadData") ||
        sessionStorage.getItem("bulkUploadData");
      if (!bulkDataRaw) {
        return toast.error("Bulk upload data not found. Please re-analyze.");
      }

      const bulkData = JSON.parse(bulkDataRaw);
      const naturalImages = bulkData.files
        ? bulkData.files.filter(
            (item: any) => item.detectionResult.natural_probability > 50
          )
        : [];

      if (naturalImages.length === 0) {
        return toast.error(
          "No authentic images to register. Please try different files."
        );
      }

      setIsRegistering(true);

      setLoadingModal({
        isVisible: true,
        title: "Registering Authentic Images",
        subtitle: `Processing ${naturalImages.length} authentic images...`,
        steps: [
          { text: "Connecting to Sepolia network", completed: false },
          { text: "Uploading files to IPFS", completed: false },
          { text: "Saving records to database", completed: false },
          { text: "Confirming on blockchain", completed: false },
        ],
        progress: 0,
      });

      logAuditEvent("REGISTRATION_COMPLETE", "Starting Bulk Registration", "PENDING", `Processing ${naturalImages.length} authentic files`);

      try {
        setLoadingModal((prev) => ({
          ...prev,
          progress: 10,
          steps: prev.steps.map((step, index) =>
            index === 0 ? { ...step, completed: true } : step
          ),
        }));

        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xaa36a7" }],
        });

        logAuditEvent("METAMASK_SIGN", "Network Switch Requested", "SUCCESS", networkInfo.name);

      } catch (switchError) {
        if ((switchError as { code: number }).code === 4902) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0xaa36a7",
                  chainName: "Sepolia",
                  rpcUrls: ["https://rpc.sepolia.org"],
                  nativeCurrency: {
                    name: "SepoliaETH",
                    symbol: "ETH",
                    decimals: 18,
                  },
                  blockExplorerUrls: ["https://sepolia.etherscan.io"],
                },
              ],
            });
            logAuditEvent("METAMASK_SIGN", "Network Added", "SUCCESS", "Sepolia added to MetaMask.");
          } catch (addError) {
            toast.error("Failed to add Sepolia network to MetaMask.");
            setIsRegistering(false);
            setLoadingModal((prev) => ({ ...prev, isVisible: false }));
            logAuditEvent("METAMASK_SIGN", "Network Switch/Add Failed", "ERROR", "Failed to add Sepolia network.");
            return;
          }
        } else {
          toast.error("Failed to switch to Sepolia network.");
          setIsRegistering(false);
          setLoadingModal((prev) => ({ ...prev, isVisible: false }));
          logAuditEvent("METAMASK_SIGN", "Network Switch Failed", "ERROR", "Failed to switch to Sepolia network.");
          return;
        }
      }

      let contentHash = "";

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const walletAddress = await signer.getAddress();

        setLoadingModal((prev) => ({
          ...prev,
          progress: 30,
          steps: prev.steps.map((step, index) =>
            index === 1 ? { ...step, completed: true } : step
          ),
        }));

        const mediaFiles: File[] = [];
        const mediaUrls: string[] = [];
        const allMetadata: any[] = [];

        logAuditEvent("DB_UPLOAD", "Preparing files for IPFS upload", "PENDING", `Downloading ${naturalImages.length} files from Cloudinary`);

        for (let i = 0; i < naturalImages.length; i++) {
          const item = naturalImages[i];

          const progress = 30 + ((i + 1) / naturalImages.length) * 20;
          setLoadingModal((prev) => ({
            ...prev,
            progress: progress,
            subtitle: `Preparing image ${i + 1} of ${naturalImages.length}: ${
              item.name.length > 30
                ? item.name.substring(0, 30) + "..."
                : item.name
            }`,
          }));

          let mediaFile: File;
          try {
            const response = await fetch(item.detectionResult.cloudinary_url);
            const blob = await response.blob();
            mediaFile = new File([blob], item.name, { type: blob.type });
            mediaFiles.push(mediaFile);
            mediaUrls.push(item.detectionResult.cloudinary_url);
          } catch (error) {
            console.error(
              `Failed to download ${item.name} from Cloudinary:`,
              error
            );
            mediaFile = new File([""], item.name, {
              type: `image/${item.mediaType}`,
            });
            mediaFiles.push(mediaFile);
            mediaUrls.push(item.detectionResult.cloudinary_url);
          }

          allMetadata.push({
            name: item.name,
            description: item.description,
            mediaType: item.mediaType,
            detectionResult: item.detectionResult,
            cloudinaryUrl: item.detectionResult.cloudinary_url,
          });
        }
        
        logAuditEvent("DB_UPLOAD", "Files Downloaded from Cloudinary", "SUCCESS", `Ready to upload ${mediaFiles.length} files to IPFS`);


        setLoadingModal((prev) => ({
          ...prev,
          progress: 50,
          subtitle: "Uploading files to IPFS...",
        }));

        logAuditEvent("DB_UPLOAD", "Uploading files to IPFS", "PENDING");

        const mediaCids: string[] = [];
        for (let i = 0; i < mediaFiles.length; i++) {
          const mediaCid = await uploadFileToPinata(mediaFiles[i]);
          mediaCids.push(mediaCid);
        }

        const combinedMetadata = {
          collectionName: bulkData.collectionName || "My Collection",
          collectionDescription: bulkData.collectionDescription || "",
          totalFiles: naturalImages.length,
          files: allMetadata,
          uploader: walletAddress,
          timestamp: new Date().toISOString(),
          isBulkUpload: true,
        };

        const metadataFile = new File(
          [JSON.stringify(combinedMetadata)],
          "bulk-metadata.json",
          {
            type: "application/json",
          }
        );
        const metadataCid = await uploadFileToPinata(metadataFile);

        contentHash = await generateSha256Hash(mediaFiles[0]);

        logAuditEvent("DB_UPLOAD", "IPFS Upload Complete", "SUCCESS", `Media CIDs: ${mediaCids.length}, Metadata CID: ${metadataCid}`);


        
        const mediaType = naturalImages[0].mediaType || "image";
        const fileFieldName = `${mediaType}s`;

        const routeMap: Record<string, string> = {
          images: API_ENDPOINTS.TAGS_WITH_IMAGES,
          videos: API_ENDPOINTS.TAGS_WITH_VIDEOS,
          audios: API_ENDPOINTS.TAGS_WITH_AUDIO,
        };
        const route = routeMap[fileFieldName] || API_ENDPOINTS.TAGS;

        const backendFormData = new FormData();
        
        // --- ADD AUDIT TRAIL DATA TO FORMDATA ---
        const auditTrail = getAuditTrail();
        if (auditTrail) {
            backendFormData.append("audit_trail", JSON.stringify({
                ...auditTrail,
                linkedHash: contentHash,
            }));
        }
        // --- END ADD AUDIT TRAIL DATA ---


        mediaFiles.forEach((file, index) => {
          backendFormData.append(fileFieldName, file);
        });

        mediaUrls.forEach((url, index) => {
          backendFormData.append(`${fileFieldName}_urls`, url);
        });

        backendFormData.append("file_name", combinedMetadata.collectionName);
        backendFormData.append(
          "description",
          combinedMetadata.collectionDescription
        );
        backendFormData.append("hash_address", contentHash);
        backendFormData.append("mediacid", mediaCids.join(","));
        backendFormData.append("metadatacid", metadataCid);
        backendFormData.append("address", walletAddress);
        backendFormData.append(
          "type",
          mediaType === "image" ? "img" : mediaType
        );
        backendFormData.append("is_bulk_upload", "true");
        backendFormData.append("file_count", naturalImages.length.toString());

        setLoadingModal((prev) => ({
          ...prev,
          progress: 60,
          subtitle: "Saving to database...",
        }));
        logAuditEvent("DB_UPLOAD", "Saving Tag record to backend database", "PENDING");

        const backendRes = await fetch(route, {
          method: "POST",
          body: backendFormData,
        });

        if (!backendRes.ok) {
          const errorData = await backendRes.json();
          console.error("Backend error:", errorData);

          if (errorData.message?.includes("already exists")) {
            throw new Error(
              "One or more files have already been registered. Please check uniqueness again."
            );
          } else if (errorData.message?.includes("duplicate")) {
            throw new Error(
              "Duplicate content detected. Please verify uniqueness before proceeding."
            );
          } else {
            throw new Error(
              errorData.message || "Failed to save bulk upload to database."
            );
          }
        }
        
        logAuditEvent("DB_UPLOAD", "Backend Database Tag Save Complete", "SUCCESS", `Tag record saved for ${naturalImages.length} files.`);


        setLoadingModal((prev) => ({
          ...prev,
          progress: 75,
          subtitle: "Registering on blockchain...",
        }));

        const contract = getEthersContract(signer);
        const formattedHash = contentHash.startsWith("0x")
          ? contentHash
          : "0x" + contentHash;

        const tx: TransactionResponse = await contract.registerMedia(
          mediaCids.join(","),
          metadataCid,
          formattedHash
        );
        
        logAuditEvent("METAMASK_SIGN", "Transaction sent to blockchain", "PENDING", `Tx Hash: ${tx.hash}`);

        await tx.wait();

        clearAuditTrail();

        setLoadingModal((prev) => ({
          ...prev,
          progress: 100,
          steps: prev.steps.map((step, index) =>
            index === 3 ? { ...step, completed: true } : step
          ),
        }));

        toast.success(
          `Successfully registered ${naturalImages.length} authentic images on-chain!`
        );
        logAuditEvent("REGISTRATION_COMPLETE", "Registration Confirmed on Chain", "SUCCESS", `Tx Confirmed: ${tx.hash}. Audit trail saved.`);

        localStorage.removeItem("bulkUploadData");
        sessionStorage.removeItem("bulkUploadData");

        setTimeout(() => {
          setLoadingModal((prev) => ({ ...prev, isVisible: false }));
          router.push("/");
        }, 1000);
      } catch (err) {
        console.error("Bulk registration error:", err);
        const error = err as {
          reason?: string;
          message?: string;
          code?: string;
        };

        let errorMessage =
          "An unexpected error occurred during bulk registration.";

        if (error.message?.includes("already been registered")) {
          errorMessage =
            "One or more files have already been registered. Please verify uniqueness again.";
        } else if (error.message?.includes("duplicate")) {
          errorMessage =
            "Duplicate content detected. Please check uniqueness before proceeding.";
        } else if (error.message?.includes("insufficient funds")) {
          errorMessage =
            "Insufficient funds for transaction. Please add more ETH to your wallet.";
        } else if (error.message?.includes("user rejected")) {
          errorMessage = "Transaction was rejected. Please try again.";
        } else if (error.reason) {
          errorMessage = error.reason;
        } else if (error.message) {
          errorMessage = error.message;
        }

        toast.error(errorMessage);
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        logAuditEvent("REGISTRATION_COMPLETE", "Registration Failed", "ERROR", errorMessage);
      } finally {
        setIsRegistering(false);
      }

      return;
    }

    const tagDataRaw = localStorage.getItem("uploadedTagData");
    const metadataRaw = localStorage.getItem("metadata");
    if (!tagDataRaw)
      return toast.error("Media data not found. Please re-analyze.");
    if (!metadataRaw)
      return toast.error("Metadata not found. Please re-analyze.");
    if (typeof window.ethereum === "undefined")
      return toast.error("MetaMask is not installed.");

    setIsRegistering(true);

    setLoadingModal({
      isVisible: true,
      title: "Registering Media",
      subtitle: "Processing blockchain registration...",
      steps: [
        { text: "Connecting to Sepolia network", completed: false },
        { text: "Uploading files to IPFS", completed: false },
        { text: "Saving record to database", completed: false },
        { text: "Confirming on blockchain", completed: false },
      ],
      progress: 0,
    });

    logAuditEvent("REGISTRATION_COMPLETE", "Starting Single Registration", "PENDING", tagData.name);

    try {
      setLoadingModal((prev) => ({
        ...prev,
        progress: 10,
        steps: prev.steps.map((step, index) =>
          index === 0 ? { ...step, completed: true } : step
        ),
      }));

      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      logAuditEvent("METAMASK_SIGN", "Network Switch Requested", "SUCCESS", networkInfo.name);

    } catch (switchError) {
      if ((switchError as { code: number }).code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0xaa36a7",
                chainName: "Sepolia",
                rpcUrls: ["https://rpc.sepolia.org"],
                nativeCurrency: {
                  name: "SepoliaETH",
                  symbol: "ETH",
                  decimals: 18,
                },
                blockExplorerUrls: ["https://sepolia.etherscan.io"],
              },
            ],
          });
          logAuditEvent("METAMASK_SIGN", "Network Added", "SUCCESS", "Sepolia added to MetaMask.");
        } catch (addError) {
          toast.error("Failed to add Sepolia network to MetaMask.");
          setIsRegistering(false);
          setLoadingModal((prev) => ({ ...prev, isVisible: false }));
          logAuditEvent("METAMASK_SIGN", "Network Switch/Add Failed", "ERROR", "Failed to add Sepolia network.");
          return;
        }
      } else {
        toast.error("Failed to switch to Sepolia network.");
        setIsRegistering(false);
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        logAuditEvent("METAMASK_SIGN", "Network Switch Failed", "ERROR", "Failed to switch to Sepolia network.");
        return;
      }
    }

    let contentHash = "";

    try {
      const tagData = JSON.parse(tagDataRaw);
      const mediaFile = base64ToFile(tagData.filePreview, tagData.name);

      const metadataFile = new File([metadataRaw], "metadata.json", {
        type: "application/json",
      });

      setLoadingModal((prev) => ({
        ...prev,
        progress: 30,
        steps: prev.steps.map((step, index) =>
          index === 1 ? { ...step, completed: true } : step
        ),
      }));

      logAuditEvent("DB_UPLOAD", "Uploading file and metadata to IPFS", "PENDING");


      const [mediaCid, metadataCid, generatedHash] = await Promise.all([
        uploadFileToPinata(mediaFile),
        uploadFileToPinata(metadataFile),
        generateSha256Hash(mediaFile),
      ]);
      contentHash = generatedHash;

      logAuditEvent("DB_UPLOAD", "IPFS Upload Complete", "SUCCESS", `MediaCID: ${mediaCid}, MetaCID: ${metadataCid}`);


      setLoadingModal((prev) => ({
        ...prev,
        progress: 60,
        steps: prev.steps.map((step, index) =>
          index === 2 ? { ...step, completed: true } : step
        ),
      }));

      logAuditEvent("DB_UPLOAD", "Saving record to backend database", "PENDING");


      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const walletAddress = await signer.getAddress();

      const mediaType = tagData.mediaType || "image";
      const fileFieldName = `${mediaType}s`;

      const routeMap: Record<string, string> = {
        images: API_ENDPOINTS.TAGS_WITH_IMAGES,
        videos: API_ENDPOINTS.TAGS_WITH_VIDEOS,
        audios: API_ENDPOINTS.TAGS_WITH_AUDIO,
      };
      const route = routeMap[fileFieldName] || API_ENDPOINTS.TAGS;

      const backendFormData = new FormData();
      
      // --- ADD AUDIT TRAIL DATA TO FORMDATA ---
      const auditTrail = getAuditTrail();
      if (auditTrail) {
          backendFormData.append("audit_trail", JSON.stringify({
              ...auditTrail,
              linkedHash: contentHash,
          }));
      }
      // --- END ADD AUDIT TRAIL DATA ---

      backendFormData.append(fileFieldName, mediaFile);
      backendFormData.append("file_name", tagData.name);
      backendFormData.append("hash_address", contentHash);
      backendFormData.append("mediacid", mediaCid);
      backendFormData.append("metadatacid", metadataCid);
      backendFormData.append("address", walletAddress);
      backendFormData.append("type", mediaType === "image" ? "img" : mediaType);

      const backendRes = await fetch(route, {
        method: "POST",
        body: backendFormData,
      });
      if (!backendRes.ok) {
        const errorData = await backendRes.json();
        throw new Error(errorData.message || "Failed to save to database.");
      }
      
      logAuditEvent("DB_UPLOAD", "Backend Database Tag Save Complete", "SUCCESS", `Record saved for ${tagData.name}.`);


      setLoadingModal((prev) => ({
        ...prev,
        progress: 80,
        steps: prev.steps.map((step, index) =>
          index === 3 ? { ...step, completed: true } : step
        ),
      }));

      const contract = getEthersContract(signer);

      if (!contentHash.startsWith("0x") || contentHash.length !== 66) {
        throw new Error(`Invalid content hash format: ${contentHash}`);
      }

      const formattedHash = contentHash;
      console.log("Using content hash for registration:", formattedHash);

      const tx: TransactionResponse = await contract.registerMedia(
        mediaCid,
        metadataCid,
        formattedHash
      );
      
      logAuditEvent("METAMASK_SIGN", "Transaction sent to blockchain", "PENDING", `Tx Hash: ${tx.hash}`);

      await tx.wait();
      
      clearAuditTrail();

      setLoadingModal((prev) => ({
        ...prev,
        progress: 100,
      }));

      toast.success("Media successfully registered on-chain!");
      logAuditEvent("REGISTRATION_COMPLETE", "Registration Confirmed on Chain", "SUCCESS", `Tx Confirmed: ${tx.hash}. Audit trail saved.`);

      localStorage.removeItem("uploadedTagData");
      localStorage.removeItem("metadata");

      setTimeout(() => {
        setLoadingModal((prev) => ({ ...prev, isVisible: false }));
        router.push("/");
      }, 1000);
    } catch (err) {
      console.error("Registration error:", err);
      const error = err as { reason?: string; message?: string };
      let errorMessage = error.reason || error.message || "An unexpected error occurred.";
      toast.error(errorMessage);
      setLoadingModal((prev) => ({ ...prev, isVisible: false }));
      logAuditEvent("REGISTRATION_COMPLETE", "Registration Failed", "ERROR", errorMessage);
    } finally {
      setIsRegistering(false);
    }
  };

  const [tagData, setTagData] = useState<{
    name?: string;
    mediaType?: string;
    filePreview?: string;
    detectionResult?: {
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
    };
  }>({});

  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedData = localStorage.getItem("uploadedTagData");
      if (storedData) {
        try {
          setTagData(JSON.parse(storedData));
        } catch (error) {
          console.error("Error parsing stored tag data:", error);
        }
      }
    }
  }, []);

  const fileName = tagData.name || defaultFileName;
  const mediaType = tagData.mediaType || defaultMediaType;

  return (
    <>
      <LoadingModal
        isVisible={loadingModal.isVisible}
        title={loadingModal.title}
        subtitle={loadingModal.subtitle}
        steps={loadingModal.steps}
        progress={loadingModal.progress}
        showSecurityNote={true}
      />
      <div className="max-w-4xl mx-auto">
        <Card className="bg-[#2A2D35] border-[#3A3D45] shadow-2xl">
          <CardContent className="p-8">
            <h1 className="text-3xl font-bold text-white mb-4">
              {isBulkMode
                ? bulkData.collectionName || "Review Analysis Results"
                : "Review your media tag"}
            </h1>
            <p className="text-gray-300 text-base mb-8">
              {isBulkMode
                ? `Review the analysis results for all ${
                    bulkData.files ? bulkData.files.length : 0
                  } files. Only authentic images will be uploaded to IPFS.`
                : "Check out your media tag preview and continue once you're happy with it"}
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <Card className="bg-[#3A3D45] border-[#4A4D55]">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    {isBulkMode ? (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-white font-semibold">
                            Analysis Results (
                            {bulkData.files ? bulkData.files.length : 0} files)
                          </h3>
                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() =>
                                setCurrentBulkIndex(
                                  Math.max(0, currentBulkIndex - 1)
                                )
                              }
                              disabled={currentBulkIndex === 0}
                              className="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </button>
                            <span className="text-sm text-gray-300 px-3">
                              {currentBulkIndex + 1} of{" "}
                              {bulkData.files ? bulkData.files.length : 0}
                            </span>
                            <button
                              onClick={() =>
                                setCurrentBulkIndex(
                                  Math.min(
                                    (bulkData.files
                                      ? bulkData.files.length
                                      : 1) - 1,
                                    currentBulkIndex + 1
                                  )
                                )
                              }
                              disabled={
                                currentBulkIndex ===
                                (bulkData.files ? bulkData.files.length : 1) - 1
                              }
                              className="p-2 rounded-lg bg-gray-700 text-white hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        <div className="relative">
                          <div className="w-full h-64 bg-gradient-to-br from-gray-600 to-gray-800 rounded-lg flex items-center justify-center relative overflow-hidden">
                            {bulkData.files &&
                            bulkData.files[currentBulkIndex]?.detectionResult
                              ?.cloudinary_url ? (
                              bulkData.files[currentBulkIndex].mediaType ===
                              "image" ? (
                                <img
                                  src={
                                    bulkData.files[currentBulkIndex]
                                      .detectionResult.cloudinary_url
                                  }
                                  alt={bulkData.files[currentBulkIndex].name}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                    e.currentTarget.nextElementSibling?.classList.remove(
                                      "hidden"
                                    );
                                  }}
                                />
                              ) : bulkData.files[currentBulkIndex].mediaType ===
                                "video" ? (
                                <video
                                  src={
                                    bulkData.files[currentBulkIndex]
                                      .detectionResult.cloudinary_url
                                  }
                                  className="w-full h-full object-cover"
                                  controls
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                    e.currentTarget.nextElementSibling?.classList.remove(
                                      "hidden"
                                    );
                                  }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <span className="text-gray-400 text-sm">
                                    Audio Preview
                                  </span>
                                </div>
                              )
                            ) : null}
                            <div className="hidden text-center text-white">
                              <div className="w-24 h-24 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Eye className="w-12 h-12 text-blue-400" />
                              </div>
                              <p className="text-sm text-gray-400">
                                Preview unavailable
                              </p>
                            </div>
                            {(() => {
                                const naturalProb = bulkData.files[currentBulkIndex].detectionResult.natural_probability;
                                const detectionResult = bulkData.files[currentBulkIndex].detectionResult;
                                const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                
                                return (
                                  <div
                                    className={`absolute top-3 right-3 px-2 py-1 rounded text-xs font-medium ${
                                      categorical.status === "AUTHENTIC" ? "bg-green-500 text-white" :
                                      categorical.status === "INCONCLUSIVE" ? "bg-yellow-500 text-white" :
                                      "bg-red-500 text-white"
                                    }`}
                                  >
                                    {categorical.status}
                                  </div>
                                );
                              })()}
                          </div>
                        </div>

                        {bulkData.files &&
                          bulkData.files[currentBulkIndex]?.detectionResult && (
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <h3
                                  className="text-white font-semibold truncate max-w-[200px]"
                                  title={bulkData.files[currentBulkIndex].name}
                                >
                                  {bulkData.files[currentBulkIndex].name}
                                </h3>
                                {(() => {
                                  const naturalProb = bulkData.files[currentBulkIndex].detectionResult.natural_probability;
                                  const detectionResult = bulkData.files[currentBulkIndex].detectionResult;
                                  const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                  
                                  return (
                                    <span
                                      className={`text-xs px-2 py-1 rounded ${
                                        categorical.status === "AUTHENTIC" ? "bg-green-500/20 text-green-400" :
                                        categorical.status === "INCONCLUSIVE" ? "bg-yellow-500/20 text-yellow-400" :
                                        "bg-red-500/20 text-red-400"
                                      }`}
                                    >
                                      {categorical.status === "SYNTHETIC" ? "Will be excluded" : "Will proceed to IPFS"}
                                    </span>
                                  );
                                })()}
                              </div>

                              <div className="flex items-center space-x-4">
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm text-gray-400">
                                    Deepfake:
                                  </span>
                                  {(() => {
                                    const naturalProb = bulkData.files[currentBulkIndex].detectionResult.natural_probability;
                                    const detectionResult = bulkData.files[currentBulkIndex].detectionResult;
                                    const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                    
                                    return (
                                      <span
                                        className={`text-sm font-medium ${
                                          categorical.status === "SYNTHETIC" ? "text-red-400" :
                                          categorical.status === "INCONCLUSIVE" ? "text-yellow-400" :
                                          "text-green-400"
                                        }`}
                                      >
                                        {categorical.displayDeepfake}%
                                      </span>
                                    );
                                  })()}
                                </div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm text-gray-400">
                                    Authentic:
                                  </span>
                                  {(() => {
                                    const naturalProb = bulkData.files[currentBulkIndex].detectionResult.natural_probability;
                                    const detectionResult = bulkData.files[currentBulkIndex].detectionResult;
                                    const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                    
                                    return (
                                      <span className="text-sm font-medium text-green-400">
                                        {categorical.displayAuthentic}%
                                      </span>
                                    );
                                  })()}
                                </div>
                              </div>

                              <div className="bg-[#2A2D35] p-3 rounded-lg">
                                <h5 className="text-sm font-medium text-white mb-1">
                                  Analysis Summary
                                </h5>
                                <p className="text-sm text-gray-300">
                                  {
                                    bulkData.files[currentBulkIndex]
                                      .detectionResult.reasoning.overall
                                  }
                                </p>
                              </div>
                            </div>
                          )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <h3 className="text-white font-semibold">
                            Analysis Results
                          </h3>
                        </div>
                        <div className="relative">
                          <div className="w-full h-64 bg-gradient-to-br from-gray-600 to-gray-800 rounded-lg flex items-center justify-center relative overflow-hidden">
                            {tagData.filePreview ? (
                              <img
                                src={tagData.filePreview}
                                alt="Media Preview"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="text-center text-white">
                                <div className="w-24 h-24 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                  <Eye className="w-12 h-12 text-blue-400" />
                                </div>
                                <p className="text-sm text-gray-400">
                                  Media Preview
                                </p>
                              </div>
                            )}
                            {tagData.detectionResult && (() => {
                              const naturalProb = tagData.detectionResult.natural_probability;
                              const detectionResult = tagData.detectionResult;
                              const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                              
                              return (
                                <div
                                  className={`absolute top-3 right-3 px-2 py-1 rounded text-xs font-medium ${
                                    categorical.status === "AUTHENTIC" ? "bg-green-500 text-white" :
                                    categorical.status === "INCONCLUSIVE" ? "bg-yellow-500 text-white" :
                                    "bg-red-500 text-white"
                                  }`}
                                >
                                  {categorical.status}
                                </div>
                              );
                            })()}
                          </div>
                        </div>

                        {tagData.detectionResult && (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h3
                                className="text-white font-semibold truncate max-w-[200px]"
                                title={fileName}
                              >
                                {fileName}
                              </h3>
                              {(() => {
                                const naturalProb = tagData.detectionResult.natural_probability;
                                const detectionResult = tagData.detectionResult;
                                const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                
                                return (
                                  <span
                                    className={`text-xs px-2 py-1 rounded ${
                                      categorical.status === "AUTHENTIC" ? "bg-green-500/20 text-green-400" :
                                      categorical.status === "INCONCLUSIVE" ? "bg-yellow-500/20 text-yellow-400" :
                                      "bg-red-500/20 text-red-400"
                                    }`}
                                  >
                                    {categorical.status === "SYNTHETIC" ? "Will be excluded" : "Will proceed to IPFS"}
                                  </span>
                                );
                              })()}
                            </div>

                            <div className="flex items-center space-x-4">
                              <div className="flex items-center space-x-2">
                                <span className="text-sm text-gray-400">
                                  Deepfake:
                                </span>
                                {(() => {
                                  const naturalProb = tagData.detectionResult.natural_probability;
                                  const detectionResult = tagData.detectionResult;
                                  const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                  
                                  return (
                                    <span
                                      className={`text-sm font-medium ${
                                        categorical.status === "SYNTHETIC" ? "text-red-400" :
                                        categorical.status === "INCONCLUSIVE" ? "text-yellow-400" :
                                        "text-green-400"
                                      }`}
                                    >
                                      {categorical.displayDeepfake}%
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className="flex items-center space-x-2">
                                <span className="text-sm text-gray-400">
                                  Authentic:
                                </span>
                                {(() => {
                                  const naturalProb = tagData.detectionResult.natural_probability;
                                  const detectionResult = tagData.detectionResult;
                                  const categorical = getCategoricalProbabilities(naturalProb, detectionResult);
                                  
                                  return (
                                    <span className="text-sm font-medium text-green-400">
                                      {categorical.displayAuthentic}%
                                    </span>
                                  );
                                })()}
                              </div>
                            </div>

                            <div className="bg-[#2A2D35] p-3 rounded-lg">
                              <h5 className="text-sm font-medium text-white mb-1">
                                Analysis Summary
                              </h5>
                              <p className="text-sm text-gray-300">
                                {tagData.detectionResult.reasoning.overall}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#3A3D45] border-[#4A4D55]">
                <CardContent className="p-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-semibold flex items-center">
                        <Zap className="w-5 h-5 mr-2 text-blue-400" />
                        Transaction Fees
                      </h3>
                      <Button
                        onClick={() => {
                          estimateGasFees();
                          getNetworkInfo();
                        }}
                        disabled={isLoadingFees}
                        className="bg-gray-600 hover:bg-gray-700 text-white p-2 h-8 w-8"
                      >
                        <RefreshCw
                          className={`w-4 h-4 ${
                            isLoadingFees ? "animate-spin" : ""
                          }`}
                        />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      <div className="bg-[#2A2D35] rounded-lg p-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-gray-300 text-sm">
                            Gas Price
                          </span>
                          <div className="text-right">
                            <div className="text-white font-medium">
                              {isLoadingFees
                                ? "..."
                                : `${parseFloat(gasPrice).toFixed(2)} Gwei`}
                            </div>
                            <div className="text-gray-400 text-xs">
                              via {gasPriceSource}
                            </div>
                          </div>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-300 text-sm">
                            Estimated Fee
                          </span>
                          <div className="text-right">
                            <div className="text-green-400 font-semibold">
                              {isLoadingFees
                                ? "..."
                                : `${parseFloat(gasFee).toFixed(6)} ETH`}
                            </div>
                            <div className="text-gray-400 text-xs">
                              Testnet (No Real Value)
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="bg-[#2A2D35] rounded-lg p-4">
                        <div className="text-center">
                          <p className="text-gray-300 text-sm mb-1">Network</p>
                          <p className="text-blue-400 font-medium">
                            {networkInfo.name}
                          </p>
                          <p className="text-gray-400 text-xs">
                            Chain ID: {networkInfo.chainId}
                          </p>
                        </div>
                      </div>

                      <div className="bg-[#2A2D35] rounded-lg p-4">
                        <div className="text-center">
                          <p className="text-gray-300 text-sm mb-1">Contract</p>
                          <p className="text-gray-400 text-xs font-mono break-all">
                            {CONTRACT_ADDRESS}
                          </p>
                        </div>
                      </div>

                      <div className="bg-[#1a1d23] border border-yellow-500/30 rounded-lg p-4">
                        <div className="text-center">
                          <p className="text-yellow-400 text-sm font-medium mb-1">
                            💡 Need SepoliaETH?
                          </p>
                          <p className="text-gray-300 text-xs">
                            Get free testnet ETH from{" "}
                            <a
                              href="https://sepoliafaucet.com"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 underline"
                            >
                              Sepolia Faucet
                            </a>
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {isBulkMode && bulkData.files && bulkData.files.length > 0 && (
              <div className="mb-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-blue-500/20 rounded-full flex items-center justify-center">
                    <Check className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-blue-300 font-medium">
                      Only authentic images go further
                    </p>
                    <p className="text-blue-200/80 text-sm">
                      {
                        bulkData.files.filter(
                          (item) =>
                            item.detectionResult.deepfake_probability < 50
                        ).length
                      }{" "}
                      out of {bulkData.files.length} files will be uploaded to
                      IPFS and registered on-chain
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#2A2D35] border-t border-[#3A3D45] p-4 flex justify-between items-center -mx-8 -mb-8 mt-8">
              <Button
                variant="outline"
                onClick={onCancel}
                className="bg-transparent border-gray-600 text-white hover:bg-[#3A3D45] hover:border-gray-500 transition-all duration-200"
              >
                Cancel
              </Button>

              <div className="flex items-center space-x-3">
                <Button
                  onClick={handleRegister}
                  className="bg-blue-600 text-white hover:bg-blue-700 px-6 py-3 transition-all duration-200 shadow-lg hover:shadow-xl"
                  disabled={isRegistering}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  {isRegistering
                    ? "Processing..."
                    : isBulkMode
                    ? `Register ${
                        bulkData.files
                          ? bulkData.files.filter(
                              (item) =>
                                item.detectionResult.deepfake_probability < 50
                            ).length
                          : 0
                      } Authentic Images on Chain`
                    : "Register on Chain"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}