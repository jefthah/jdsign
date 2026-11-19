import { Suspense } from "react";
import { AccountMenu, AccountMenuSkeleton } from "@/components/account/account-menu";
import { summarize } from "@/components/account/links";
import {
  CategoryTiles,
  LandingPage,
  LoginLink,
  MobileAccountLink,
} from "@/components/landing/landing-page";
import { fallbackCategories } from "@/components/landing/templates";
import { serverApi } from "@/lib/api/server";
import { getSignedInAccount } from "@/lib/api/session";

async function Categories() {
  const { data } = await serverApi
    .GET("/categories", { signal: AbortSignal.timeout(3000) })
    .catch(() => ({ data: undefined }));
  return <CategoryTiles categories={data?.data ?? fallbackCategories} />;
}

async function HeaderAccount() {
  const account = await getSignedInAccount();
  return account ? (
    <AccountMenu account={summarize(account)} tone="dark" />
  ) : (
    <LoginLink />
  );
}

async function MobileAccount() {
  return <MobileAccountLink signedIn={!!(await getSignedInAccount())} />;
}

export default function Home() {
  return (
    <LandingPage
      categories={
        <Suspense fallback={<CategoryTiles categories={fallbackCategories} />}>
          <Categories />
        </Suspense>
      }
      account={
        <Suspense fallback={<AccountMenuSkeleton tone="dark" />}>
          <HeaderAccount />
        </Suspense>
      }
      mobileAccount={
        <Suspense fallback={<MobileAccountLink signedIn={false} />}>
          <MobileAccount />
        </Suspense>
      }
    />
  );
}
