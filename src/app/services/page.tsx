import { ServicesClient } from "@/components/services/services-client";
import { bbcEnabled } from "@/lib/features";

/** Плитка BBC Dashboard — только если раздел не выключен (`src/lib/features.ts`). */
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  return <ServicesClient bbcEnabled={await bbcEnabled()} />;
}
