import type { Metadata } from "next";

import { BagContents } from "@/components/store/BagContents";

export const metadata: Metadata = { title: "Bag" };

export default function BagPage() {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-page) pt-12 pb-16">
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">Your bag</h1>
        <div className="mt-8">
          <BagContents variant="page" />
        </div>
      </div>
    </div>
  );
}
