/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Pod } from "@freelensapp/kube-object";
import { withInjectables } from "@ogre-tools/injectable-react";
import React, { useState } from "react";
import execFileInjectable, { type ExecFile } from "../../../common/fs/exec-file.injectable";
import type { Cluster } from "../../../common/cluster/cluster";
import { App } from "../../../extensions/common-api";
import hostedClusterIdInjectable from "../../cluster-frame-context/hosted-cluster-id.injectable";
import getClusterByIdInjectable, { type GetClusterById } from "../../../features/cluster/storage/common/get-by-id.injectable";
import PodMenuItem from "./pod-menu-item";
import { Button } from "@freelensapp/button";

import type { Container, EphemeralContainer } from "@freelensapp/kube-object";

export interface PodFileExplorerMenuProps {
  object: any;
  toolbar: boolean;
}

interface Dependencies {
  execFile: ExecFile;
  hostedClusterId: string | undefined;
  getClusterById: GetClusterById;
}

interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  permissions?: string;
  expanded?: boolean;
  children?: FileEntry[];
  loading?: boolean;
}


const FileTreeNode: React.FC<{
  entry: FileEntry;
  level: number;
  onToggleExpand: (path: string) => void;
  onDownloadFile: (path: string) => void;
  onLoadChildren: (path: string) => void;
}> = ({ entry, level, onToggleExpand, onDownloadFile, onLoadChildren }) => {
  return (
    <>
      <div
        style={{
          paddingLeft: `${level * 20}px`,
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          borderBottom: "1px solid var(--borderFaintColor)",
        }}
        onMouseEnter={(e) => {
          if (entry.isDirectory) e.currentTarget.style.background = "var(--menuActiveBackground)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {entry.isDirectory ? (
          <Button
            onClick={() => {
              if (!entry.expanded && !entry.children) {
                onLoadChildren(entry.path);
              }
              onToggleExpand(entry.path);
            }}
            plain
            aria-label={entry.expanded ? "Collapse folder" : "Expand folder"}
            style={{ padding: "0 4px", minWidth: "20px", height: "20px" }}
          >
            {entry.loading ? "⏳" : entry.expanded ? "▼" : "▶"}
          </Button>
        ) : (
          <div style={{ width: "20px" }}></div>
        )}

        <span style={{ marginRight: "8px", fontSize: "16px" }}>
          {entry.isDirectory ? "📁" : "📄"}
        </span>

        <span style={{ flex: 1, fontSize: "13px", fontFamily: "monospace", color: "var(--textColorPrimary)" }}>
          {entry.name}
        </span>

        {entry.size && (
          <span
            style={{
              fontSize: "11px",
              color: "var(--textColorTertiary)",
              marginRight: "12px",
              minWidth: "60px",
              textAlign: "right",
            }}
          >
            {(entry.size / 1024).toFixed(1)} KB
          </span>
        )}

        {!entry.isDirectory && (
          <Button
            onClick={() => onDownloadFile(entry.path)}
            primary
            label="Download"
            style={{ marginLeft: "8px", fontSize: "11px" }}
          />
        )}
      </div>

      {entry.expanded && entry.children && entry.children.length > 0 && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              level={level + 1}
              onToggleExpand={onToggleExpand}
              onDownloadFile={onDownloadFile}
              onLoadChildren={onLoadChildren}
            />
          ))}
        </div>
      )}
    </>
  );
};

const FileExplorerDialog: React.FC<{
  pod: Pod;
  container: Container | EphemeralContainer;
  onClose: () => void;
  execFile: ExecFile;
  cluster?: Cluster;
}> = ({ pod, container, onClose, execFile, cluster }) => {
  const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kubectlPath = App.Preferences.getKubectlPath() || "kubectl";

  const parseListOutput = (output: string, basePath: string): FileEntry[] => {
    if (!output || typeof output !== "string") return [];

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("total"))
      .map((line): FileEntry | null => {
        const parts = line.split(/\s+/);

        if (parts.length < 9) {
          return null;
        }

        const permissions = parts[0];
        const name = parts.slice(8).join(" ");
        const isDirectory = permissions.startsWith("d");
        const size = parseInt(parts[4], 10);
        const fullPath = basePath === "/" ? `/${name}` : `${basePath}/${name}`;

        if (name === "." || name === "..") {
          return null;
        }

        return {
          name,
          path: fullPath,
          isDirectory,
          size: isDirectory ? undefined : Number.isNaN(size) ? undefined : size,
          permissions,
          expanded: false,
          children: isDirectory ? [] : undefined,
        };
      })
      .filter((entry): entry is FileEntry => Boolean(entry));
  };

  const execKubectl = React.useCallback(
    async (args: string[]) => {
      if (!cluster) {
        throw new Error("Cluster not available. Ensure the cluster is connected.");
      }

      const result = await execFile(kubectlPath, args);

      if (!result.callWasSuccessful) {
        const message = result.error?.stderr || result.error?.message || "Failed to run kubectl";

        throw new Error(message);
      }

      return result.response;
    },
    [cluster, execFile, kubectlPath],
  );

  const buildKubectlArgs = React.useCallback(
    (commandArgs: string[]) => {
      const args: string[] = [];
      const kubeconfigPath = cluster?.kubeConfigPath.get();
      const contextName = cluster?.contextName.get();

      if (kubeconfigPath) {
        args.push("--kubeconfig", kubeconfigPath);
      }

      if (contextName) {
        args.push("--context", contextName);
      }

      return [...args, ...commandArgs];
    },
    [cluster],
  );

  const listFilesAtPath = React.useCallback(
    async (path: string) => {
      const safePath = path.replace(/"/g, "\\\"");
      const command = `ls -la -- "${safePath}"`;
      const args = buildKubectlArgs([
        "exec",
        "-i",
        "-n",
        pod.getNs(),
        pod.getName(),
        "-c",
        container.name,
        "--",
        "sh",
        "-c",
        command,
      ]);
      const output = await execKubectl(args);

      return parseListOutput(output, path);
    },
    [buildKubectlArgs, container.name, execKubectl, pod],
  );

  const loadRootFiles = React.useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const files = await listFilesAtPath("/");

      setRootFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
      setRootFiles([]);
    } finally {
      setLoading(false);
    }
  }, [listFilesAtPath]);

  React.useEffect(() => {
    void loadRootFiles();
  }, [loadRootFiles]);

  const toggleExpand = (path: string) => {
    const updateFiles = (files: FileEntry[]): FileEntry[] => {
      return files.map((file) => {
        if (file.path === path) {
          return { ...file, expanded: !file.expanded };
        }
        if (file.children) {
          return { ...file, children: updateFiles(file.children) };
        }
        return file;
      });
    };
    setRootFiles((current) => updateFiles(current));
  };

  const loadChildren = async (path: string) => {
    const updateFiles = (files: FileEntry[]): FileEntry[] => {
      return files.map((file) => {
        if (file.path === path) {
          return { ...file, loading: true };
        }
        if (file.children) {
          return { ...file, children: updateFiles(file.children) };
        }
        return file;
      });
    };
    setRootFiles((current) => updateFiles(current));

    try {
      const children = await listFilesAtPath(path);

      const updateFilesWithChildren = (files: FileEntry[]): FileEntry[] => {
        return files.map((file) => {
          if (file.path === path) {
            return { ...file, children, loading: false };
          }
          if (file.children) {
            return { ...file, children: updateFilesWithChildren(file.children) };
          }
          return file;
        });
      };
      setRootFiles((current) => updateFilesWithChildren(current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load directory");
      const updateFilesOnError = (files: FileEntry[]): FileEntry[] => {
        return files.map((file) => {
          if (file.path === path) {
            return { ...file, loading: false };
          }
          if (file.children) {
            return { ...file, children: updateFilesOnError(file.children) };
          }
          return file;
        });
      };
      setRootFiles((current) => updateFilesOnError(current));
    }
  };

  const downloadFile = async (filePath: string) => {
    const fileName = filePath.split("/").pop() || "download";
    const downloadDir = `${process.env.HOME || "~"}/Downloads`;

    try {
      const args = buildKubectlArgs([
        "cp",
        "-c",
        container.name,
        `${pod.getNs()}/${pod.getName()}:${filePath}`,
        `${downloadDir}/${fileName}`,
      ]);

      await execKubectl(args);
      alert(`File downloaded to ~/Downloads/${fileName}`);
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        bottom: 0,
        width: "450px",
        background: "var(--dialogBackground)",
        borderRight: "1px solid var(--borderColor)",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        boxShadow: "var(--boxShadow)",
      }}
    >
      <div
        style={{
          padding: "16px",
          borderBottom: "1px solid var(--borderFaintColor)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "var(--dialogHeaderBackground)",
          color: "var(--dialogTextColor)",
        }}
      >
        <h3 style={{ margin: 0, color: "var(--dialogTextColor)" }}>File Explorer</h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            fontSize: "20px",
            cursor: "pointer",
            padding: "0",
            color: "var(--textColorPrimary)",
          }}
        >
          ✕
        </button>
      </div>

      <div
        style={{
          padding: "12px 16px",
          fontSize: "12px",
          color: "var(--textColorSecondary)",
          borderBottom: "1px solid var(--borderFaintColor)",
          background: "var(--dialogHeaderBackground)",
        }}
      >
        <div><strong>Pod:</strong> {pod.getName()}</div>
        <div><strong>Namespace:</strong> {pod.getNs()}</div>
        <div><strong>Container:</strong> {container.name}</div>
      </div>

      {error && (
        <div
          style={{
            margin: "12px",
            padding: "8px",
            background: "var(--colorSoftError)",
            color: "var(--colorError)",
            borderRadius: "4px",
            fontSize: "12px",
            border: "1px solid var(--colorError)",
          }}
        >
          Error: {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", background: "var(--contentColor)" }}>
        {loading ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--textColorTertiary)" }}>
            Loading files...
          </div>
        ) : rootFiles.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "var(--textColorTertiary)" }}>
            No files found
          </div>
        ) : (
          <div>
            {rootFiles.map((file) => (
              <FileTreeNode
                key={file.path}
                entry={file}
                level={0}
                onToggleExpand={toggleExpand}
                onDownloadFile={downloadFile}
                onLoadChildren={loadChildren}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const NonInjectablePodFileExplorerMenu: React.FC<PodFileExplorerMenuProps & Dependencies> = (props) => {
  const { object, toolbar, execFile, hostedClusterId, getClusterById } = props;
  const [showExplorer, setShowExplorer] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<Container | EphemeralContainer | null>(null);

  if (!object) return null;
  let pod: Pod;

  try {
    pod = new Pod(object);
  } catch (ex) {
    console.log(ex);
    return null;
  }

  const containers = pod.getRunningContainersWithType();

  if (!containers || !containers.length) return null;
  const cluster = hostedClusterId ? getClusterById(hostedClusterId) : undefined;

  return (
    <>
      <PodMenuItem
        material="folder_open"
        title="File Explorer"
        tooltip="File Explorer"
        toolbar={toolbar}
        containers={containers}
        statuses={pod.getContainerStatuses()}
        onMenuItemClick={(container) => {
          setSelectedContainer(container);
          setShowExplorer(true);
        }}
      />

      {showExplorer && selectedContainer && (
        <>
          <FileExplorerDialog
            pod={pod}
            container={selectedContainer}
            onClose={() => {
              setShowExplorer(false);
              setSelectedContainer(null);
            }}
            execFile={execFile}
            cluster={cluster}
          />
          <div
            onClick={() => {
              setShowExplorer(false);
              setSelectedContainer(null);
            }}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: "rgba(0, 0, 0, 0.3)",
              zIndex: 9999,
            }}
          />
        </>
      )}
    </>
  );
};

export const PodFileExplorerMenu = withInjectables<Dependencies, PodFileExplorerMenuProps>(
  NonInjectablePodFileExplorerMenu,
  {
    getProps: (di, props) => ({
      ...props,
      execFile: di.inject(execFileInjectable),
      hostedClusterId: di.inject(hostedClusterIdInjectable),
      getClusterById: di.inject(getClusterByIdInjectable),
    }),
  }
);
