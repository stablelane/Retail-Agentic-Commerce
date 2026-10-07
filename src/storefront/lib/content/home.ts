export const HERO_ID = "hero";

export const homeContent = {
  hero: {
    eyebrow: "Introducing",
    headline: "Our Newest Arrivals",
    body: "Curate a space that feels like home. Our handcrafted pieces bring warmth, order and a touch of quiet luxury to your day.",
    // Drop a file at public/hero.jpg (or point this at an https URL) to replace the gradient.
    image: { src: "/hero.jpg", alt: "" },
  },
  gridTitle: "Curate Your Space.",
} as const;
