import { ChangesSerializer, Collabswarm, CRDTProvider, CRDTSyncMessage, MessageSerializer } from "@collabswarm/collabswarm";
import { useEffect, useState } from "react";

export function useCollabswarm<DocType, ChangesType, ChangeFnType, MessageType extends CRDTSyncMessage<ChangesType>>(
  provider: CRDTProvider<DocType, ChangesType, ChangeFnType, MessageType>,
  changesSerializer: ChangesSerializer<ChangesType>,
  messageSerializer: MessageSerializer<MessageType>,
) {
  const [collabswarm, setCollabswarm] = useState<Collabswarm<DocType, ChangesType, ChangeFnType, MessageType> | undefined>();

  useEffect(() => {
    setCollabswarm(new Collabswarm(provider, changesSerializer, messageSerializer));
  });

  return collabswarm;
}
