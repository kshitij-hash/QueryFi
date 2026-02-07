import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia, arcTestnet } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "QueryFi",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
  chains: [baseSepolia, arcTestnet],
  ssr: true,
});
