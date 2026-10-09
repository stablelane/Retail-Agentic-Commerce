export const HERO_ID = "hero";

export const homeContent = {
  hero: {
    eyebrow: "1 Oct – 31 Dec 2026",
    headline: "What’s on in Dubai this season",
    body: "Shows, sport, family days and nights out. Pick a date, check the seats, and leave with e-tickets.",
    // Drop a file at public/hero.jpg (or point this at an https URL) to replace the gradient.
    image: { src: "/hero.jpg", alt: "" },
    // Muted background loop over the image; use a local "/hero.mp4" to self-host.
    video: {
      src: "https://www.visitdubai.com/-/media/images/leisure/festivals/dubai-festivals/hero-video/dfre-1920x1080-no-logo-1.mp4",
    },
  },
  gridTitle: "This week in Dubai",
} as const;
