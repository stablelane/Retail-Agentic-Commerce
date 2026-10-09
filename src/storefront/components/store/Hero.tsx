import { existsSync } from "node:fs";
import path from "node:path";
import Image from "next/image";

import { HeroVideo } from "@/components/store/HeroVideo";
import { HERO_ID, homeContent } from "@/lib/content/home";

function heroImageAvailable(src: string): boolean {
  if (src.startsWith("https://")) return true;
  if (!/^\/[A-Za-z0-9._-]+$/.test(src)) return false;
  return existsSync(path.join(/* turbopackIgnore: true */ process.cwd(), "public", src));
}

export function Hero() {
  const { eyebrow, headline, body, image, video } = homeContent.hero;
  const hasImage = heroImageAvailable(image.src);
  const hasVideo = heroImageAvailable(video.src);

  return (
    <section
      id={HERO_ID}
      aria-label={`${eyebrow} ${headline}`}
      className="hero-fallback relative h-[clamp(480px,72vh,640px)] w-full overflow-hidden"
    >
      {hasImage ? (
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />
      ) : null}
      {hasVideo ? <HeroVideo src={video.src} poster={hasImage ? image.src : undefined} /> : null}
      <div aria-hidden="true" className="hero-overlay absolute inset-0" />
      <div className="absolute inset-x-4 bottom-8 flex flex-col gap-4 text-white sm:inset-x-8 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-serif text-eyebrow leading-none italic">{eyebrow}</p>
          <h1 className="mt-1 font-serif text-[30px] leading-[1.1] font-normal sm:text-[36px] lg:text-hero">
            {headline}
          </h1>
        </div>
        <p className="max-w-[380px] text-small leading-[1.4]">{body}</p>
      </div>
    </section>
  );
}
