import { useEffect, useState } from "react";

import type { SocialIndex } from "./social-types";

type SocialDataState =
  | { status: "loading"; data?: undefined; error?: undefined }
  | { status: "ready"; data: SocialIndex; error?: undefined }
  | { status: "error"; data?: undefined; error: string };

export function useSocialIndex(): SocialDataState {
  const [state, setState] = useState<SocialDataState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const response = await fetch(`/social-index.json?ts=${Date.now()}`);
        if (!response.ok) {
          throw new Error(`Unable to load social-index.json (${response.status})`);
        }
        const data = (await response.json()) as SocialIndex;
        if (isMounted) {
          setState({ status: "ready", data });
        }
      } catch (error) {
        if (isMounted) {
          setState({
            status: "error",
            error: error instanceof Error ? error.message : "Unable to load social data.",
          });
        }
      }
    }

    void load();

    return () => {
      isMounted = false;
    };
  }, []);

  return state;
}

export function getPersonPath(personId: string) {
  return `/accounts/${personId}`;
}
