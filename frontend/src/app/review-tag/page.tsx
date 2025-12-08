"use client";

import AuthenticatedLayout from "@/components/custom/layouts/authenticated-layout";
import ReviewTagModal from "@/components/custom/review-tag-modal";
import { useRouter } from "next/navigation";

export default function ReviewTagPage() {
  const router = useRouter();

  const handleCancel = () => {
    router.push("/create-tag");
  };

  return (
    <AuthenticatedLayout>
      <div className="min-h-screen flex items-center justify-center p-8 bg-[#181A1D]">
        <ReviewTagModal onCancel={handleCancel} />
      </div>
    </AuthenticatedLayout>
  );
}