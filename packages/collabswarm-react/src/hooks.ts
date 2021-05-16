import { Collabswarm, CRDTProvider, CRDTSyncMessage } from "@collabswarm/collabswarm";
import { useEffect, useState } from "react";

export function useCollabswarm<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType, MessageType>,
) {
  const [collabswarm, setCollabswarm] = useState<Collabswarm<DocType, ChangesType, ChangeFnType, MessageType> | undefined>();

  useEffect(() => {
    setCollabswarm(new Collabswarm(provider));
  });

  return collabswarm;
}
