import { useEffect, useState } from "react";
import { BusinessClient } from "./business-client";
import { nativeSecureSessionStore, sessionAuthClient } from "./native-clients";

export type MerchantAccount = { id: string; name: string };

// useMerchantIdentity loads the user's shops for publish-as-merchant.
//
// MERCHANT-PUBLISH-001: PublishDemand (market) and the tasks create form
// share this hook so the shop list logic cannot drift. Fail-soft: no
// session / no shops / request error → accounts = [] and the UI stays
// personal-only (never blocks publishing as self).
export function useMerchantIdentity(): {
  accounts: MerchantAccount[];
  merchantId: string | undefined;
  setMerchantId: (id: string | undefined) => void;
} {
  const [client] = useState(
    () => new BusinessClient({ authClient: sessionAuthClient, secureSessionStore: nativeSecureSessionStore })
  );
  const [accounts, setAccounts] = useState<MerchantAccount[]>([]);
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void client
      .listMyAccounts()
      .then((rows) => {
        if (!active) return;
        setAccounts(rows.filter((row) => row.status === "ACTIVE").map((row) => ({ id: row.id, name: row.name })));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client]);
  return { accounts, merchantId, setMerchantId };
}
