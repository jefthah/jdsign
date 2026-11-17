import { Suspense } from "react";
import { CategoryTiles, LandingPage } from "@/components/landing/landing-page";
import { fallbackCategories } from "@/components/landing/templates";
import { serverApi } from "@/lib/api/server";

async function Categories() {
  const { data } = await serverApi
    .GET("/categories", { signal: AbortSignal.timeout(3000) })
    .catch(() => ({ data: undefined }));
  return <CategoryTiles categories={data?.data ?? fallbackCategories} />;
}

export default function Home() {
  return (
    <LandingPage
      categories={
        <Suspense fallback={<CategoryTiles categories={fallbackCategories} />}>
          <Categories />
        </Suspense>
      }
    />
  );
}
