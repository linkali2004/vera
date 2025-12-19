"use client";

import { SignUpCard } from "@/components/custom/signup-card";
import { useAuth } from "@/context/AuthContext";
import { API_ENDPOINTS } from "@/lib/config";
import { getAddress } from "ethers";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import toast, { Toaster } from "react-hot-toast";

export default function SignUpPage() {
  const { isAuthorized, login, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isAuthLoading && isAuthorized) {
      router.push("/");
    }
  }, [isAuthorized, isAuthLoading, router]);

  const handleConnectWallet = async () => {
    if (typeof window.ethereum === "undefined") {
      toast.error("");
      return;
    }
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      const checksummedAddress = getAddress(accounts[0]);
      setConnectedAddress(checksummedAddress);
      toast.success("Wallet connected successfully!");
    } catch (err) {
      toast.error("Failed to connect wallet. The request was rejected.");
      console.error(err);
    }
  };

  const handleSignUp = async () => {
    if (!username || !email || !connectedAddress) {
      toast.error("Please fill all fields and connect your wallet.");
      return;
    }
    setIsLoading(true);
    const toastId = toast.loading("Creating your account...");

    try {
      const response = await fetch(API_ENDPOINTS.USERS, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          email,
          address: connectedAddress,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || "Sign up failed. Please try again."
        );
      }

      const newUser = await response.json();
      
      // Extract user data from the API response and pass to login function
      const user = {
        address: newUser.data.user.address,
        username: newUser.data.user.username,
        email: newUser.data.user.email,
        profile_img: newUser.data.user.profile_img,
      };
      
      login(user);

      toast.success("Account created successfully! Redirecting...", {
        id: toastId,
      });

      setTimeout(() => {
        router.push("/");
      }, 1000);
    } catch (err: any) {
      toast.error(err.message || "An unknown error occurred.", { id: toastId });
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNavigateToLogin = () => {
    router.push("/login");
  };

  if (isAuthLoading || isAuthorized) {
    return <div className="relative min-h-dvh overflow-hidden bg-gray-900" />;
  }

  return (
    <>
      <Toaster position="top-center" reverseOrder={false} />
      <main className="relative min-h-dvh overflow-hidden">
        <img
          src="/images/login-bg.jpg"
          alt="Abstract 3D ring background"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
        <section className="relative mx-[7%] flex min-h-dvh max-w-7xl items-center justify-end px-4">
          <div className="w-full max-w-md">
            <SignUpCard
              username={username}
              onUsernameChange={setUsername}
              email={email}
              onEmailChange={setEmail}
              connectedAddress={connectedAddress}
              onConnectWallet={handleConnectWallet}
              onSignUp={handleSignUp}
              onNavigateToLogin={handleNavigateToLogin}
              isLoading={isLoading}
            />
          </div>
        </section>
      </main>
    </>
  );
}
