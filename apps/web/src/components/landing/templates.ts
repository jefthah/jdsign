export type Template = {
  id: string;
  name: string;
  title: string;
  category: string;
  categoryLabel: string;
  seller: string;
  technology: string;
  price: number;
  tone: string;
  headline: string;
  subtitle: string;
};

// Illustrative content from design.figcraft, never a live product inventory.
export const templates: Template[] = [
  {
    id: "arunika",
    name: "Arunika",
    title: "Portfolio Studio Kreatif",
    category: "portfolio",
    categoryLabel: "Portfolio",
    seller: "Studio Arunika",
    technology: "Next.js · Tailwind",
    price: 349000,
    tone: "sage",
    headline: "Independent minds.\nExtraordinary ideas.",
    subtitle: "A creative studio for a world that never stands still.",
  },
  {
    id: "lumbung",
    name: "Lumbung",
    title: "Toko Online Kopi & Teh",
    category: "ecommerce",
    categoryLabel: "Toko online",
    seller: "Kriya Digital",
    technology: "Laravel · Livewire",
    price: 449000,
    tone: "peach",
    headline: "Good things,\ngrown slowly.",
    subtitle: "Thoughtfully sourced coffee. A little ritual, every day.",
  },
  {
    id: "sagara",
    name: "Sagara",
    title: "Landing Page Kafe & Resto",
    category: "landing-page",
    categoryLabel: "Landing page",
    seller: "Ombak Studio",
    technology: "HTML · Tailwind",
    price: 179000,
    tone: "sky",
    headline: "A slower pace.\nA better place.",
    subtitle: "Come for the coffee. Stay for everything else.",
  },
  {
    id: "pilar",
    name: "Pilar",
    title: "Company Profile Konstruksi",
    category: "business",
    categoryLabel: "Bisnis",
    seller: "Rancang Lab",
    technology: "Next.js · TypeScript",
    price: 399000,
    tone: "ink",
    headline: "Building tomorrow.\nStarting today.",
    subtitle: "Spaces with purpose. Built to make a difference.",
  },
  {
    id: "lensa",
    name: "Lensa",
    title: "Portfolio Fotografer",
    category: "portfolio",
    categoryLabel: "Portfolio",
    seller: "Kamar Gelap",
    technology: "Astro · Tailwind",
    price: 249000,
    tone: "lavender",
    headline: "Between light\nand a little life.",
    subtitle: "Selected photographs, collected moments. By Alex.",
  },
  {
    id: "kelasku",
    name: "Kelasku",
    title: "Landing Kursus Online",
    category: "landing-page",
    categoryLabel: "Landing page",
    seller: "Rancang Lab",
    technology: "React · Vite",
    price: 199000,
    tone: "sand",
    headline: "Your next chapter\nstarts right here.",
    subtitle: "Small steps. New skills. A world of possibilities.",
  },
];

export const fallbackCategories = [
  { id: 1, name: "Portfolio", slug: "portfolio" },
  { id: 2, name: "Bisnis", slug: "business" },
  { id: 3, name: "E-commerce", slug: "ecommerce" },
  { id: 4, name: "Landing page", slug: "landing-page" },
];

export type Category = (typeof fallbackCategories)[number];
export const categoryStyles: Record<
  string,
  { label: string; note: string; tone: string; template: number }
> = {
  portfolio: {
    label: "Portfolio",
    note: "Ruang untuk karya, cerita, dan karakter Anda.",
    tone: "sage",
    template: 0,
  },
  business: {
    label: "Bisnis & agensi",
    note: "Rumah digital untuk bisnis dan ide besar Anda.",
    tone: "peach",
    template: 3,
  },
  ecommerce: {
    label: "Toko online",
    note: "Etalase baru untuk produk yang istimewa.",
    tone: "sky",
    template: 1,
  },
  "landing-page": {
    label: "Landing page",
    note: "Satu halaman. Satu fokus. Kesan yang kuat.",
    tone: "lavender",
    template: 5,
  },
};
export const rupiah = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
