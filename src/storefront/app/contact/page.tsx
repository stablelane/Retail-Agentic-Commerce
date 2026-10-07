import type { Metadata } from "next";

import { OpenChatButton } from "@/components/chat/OpenChatButton";

export const metadata: Metadata = { title: "Contact" };

const SUPPORT_EMAIL = "support@matter.example";

export default function ContactPage() {
  return (
    <div className="px-4 pt-14 sm:px-8">
      <div className="mx-auto max-w-(--container-content) pt-12">
        <h1 className="font-serif text-h2 leading-[1.1] font-normal">Contact us</h1>
        <p className="mt-4 text-body leading-[1.5]">
          Questions about an order, sizing or returns? Our assistant can answer most things
          instantly, and our team is happy to help with the rest.
        </p>

        <dl className="mt-8 grid gap-6 rounded-card bg-surface p-6 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-text-secondary">Email</dt>
            <dd className="mt-1 text-body font-semibold">
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
                {SUPPORT_EMAIL}
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-caption text-text-secondary">Hours</dt>
            <dd className="mt-1 text-body">Mon–Fri, 9am–6pm PT</dd>
            <dd className="text-body">Sat, 10am–4pm PT</dd>
          </div>
        </dl>

        <div className="mt-8">
          <OpenChatButton label="Chat with us" />
        </div>
      </div>
    </div>
  );
}
