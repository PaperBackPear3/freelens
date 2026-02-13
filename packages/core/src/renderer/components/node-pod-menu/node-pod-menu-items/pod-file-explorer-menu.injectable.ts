import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { kubeObjectMenuItemInjectionToken } from "../../kube-object-menu/kube-object-menu-item-injection-token";
import { PodFileExplorerMenu } from "../pod-file-explorer-menu";

import type { KubeObjectMenuItemComponent } from "../../kube-object-menu/kube-object-menu-item-injection-token";

const PodFileExplorerMenuInjectable = getInjectable({
  id: "pod-file-explorer-menu-node-pod-menu",

  instantiate: () => ({
    kind: "Pod",
    apiVersions: ["v1"],
    Component: PodFileExplorerMenu as KubeObjectMenuItemComponent,
    enabled: computed(() => true),
    orderNumber: 3,
  }),
  injectionToken: kubeObjectMenuItemInjectionToken,
});

export default PodFileExplorerMenuInjectable;
