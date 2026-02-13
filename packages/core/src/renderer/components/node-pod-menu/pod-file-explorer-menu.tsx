/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Pod } from "@freelensapp/kube-object";
import { withInjectables } from "@ogre-tools/injectable-react";
import React, { useState } from "react";
import { App } from "../../../extensions/common-api";
import createTerminalTabInjectable from "../dock/terminal/create-terminal-tab.injectable";
import sendCommandInjectable, { type SendCommand } from "../dock/terminal/send-command.injectable";
import hideDetailsInjectable, { type HideDetails } from "../kube-detail-params/hide-details.injectable";
import PodMenuItem from "./pod-menu-item";

import type { Container, EphemeralContainer } from "@freelensapp/kube-object";
import type { DockTabCreateSpecific } from "../dock/dock/store";

export interface PodFileExplorerMenuProps {
  object: any;
  toolbar: boolean;
}

interface Dependencies {
  createTerminalTab: (tabParams: DockTabCreateSpecific) => void;
  sendCommand: SendCommand;
  hideDetails: HideDetails;
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
  const hasChildren = entry.isDirectory && (entry.children === undefined || entry.children.length > 0);

  return (
    <>
      <div
        style={{
          paddingLeft: `${level * 20}px`,
          display: "flex",
          alignItems: "center",
          padding: "6px 8px",
          borderBottom: "1px solid #f0f0f0",
          hoverStyle: entry.isDirectory ? "background: #f9f9f9" : "none",
        }}
      >
        {entry.isDirectory ? (
          <button
            onClick={() => {
              if (!entry.expanded && !entry.children) {
                onLoadChildren(entry.path);
              }
              onToggleExpand(entry.path);
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0 4px",
              fontSize: "12px",
              width: "20px",
              height: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {entry.loading ? "⏳" : entry.expanded ? "▼" : "▶"}
          </button>
        ) : (
          <div style={{ width: "20px" }}></div>
        )}

        <span style={{ marginRight: "8px", fontSize: "16px" }}>
          {entry.isDirectory ? "📁" : "📄"}
        </span>

        <span style={{ flex: 1, fontSize: "13px", fontFamily: "monospace" }}>
          {entry.name}
        </span>

        {entry.size && (
          <span style={{ fontSize: "11px", color: "#999", marginRight: "12px", minWidth: "60px", textAlign: "right" }}>
            {(entry.size / 1024).toFixed(1)} KB
          </span>
        )}

        {!entry.isDirectory && (
          <button
            onClick={() => onDownloadFile(entry.path)}
            style={{
              background: "#4CAF50",
              color: "white",
              border: "none",
              padding: "4px 12px",
              borderRadius: "3px",
              cursor: "pointer",
              fontSize: "11px",
              marginLeft: "8px",
            }}
          >
            Download
          </button>
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
  sendCommand: SendCommand;
  createTerminalTab: (tabParams: DockTabCreateSpecific) => void;
  hideDetails: HideDetails;
}> = ({ pod, container, onClose, sendCommand, createTerminalTab, hideDetails }) => {
  const [rootFiles, setRootFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kubectlPath = App.Preferences.getKubectlPath() || "kubectl";

  React.useEffect(() => {
    loadFilesAtPath("/");
  }, []);

  const parseListOutput = (output: string, basePath: string): FileEntry[] => {
    return output
      .split("\n")
      .filter((line) => line.trim().length > 0 && !line.startsWith("total"))
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts.length < 9) return null;

        const permissions = parts[0];
        const size = parseInt(parts[4], 10);
        const name = parts.slice(8).join(" ");
        const isDirectory = permissions.startsWith("d");
        const fullPath = basePath === "/" ? `/${name}` : `${basePath}/${name}`;

        return {
          name,
          path: fullPath,
          isDirectory,
          size: isDirectory ? undefined : size,
          permissions,
          expanded: false,
          children: isDirectory ? [] : undefined,
        };
      })
      .filter((entry): entry is FileEntry => entry !== null);
  };

  const loadFilesAtPath = async (path: string) => {
    setLoading(true);
    setError(null);

    try {
      const command = `${kubectlPath} exec -i -n ${pod.getNs()} ${pod.getName()} -c ${container.name} -- ls -lah "${path}" 2>&1`;
      const output = await sendCommand(command, { enter: true });
      const files = parseListOutput(output as string, path);
      setRootFiles(files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    } finally {
      setLoading(false);
    }
  };

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
    setRootFiles(updateFiles(rootFiles));
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
    setRootFiles(updateFiles(rootFiles));

    try {
      const escapedPath = path.replace(/"/g, '\\"');
      const command = `${kubectlPath} exec -i -n ${pod.getNs()} ${pod.getName()} -c ${container.name} -- ls -lah "${escapedPath}" 2>&1`;
      const output = await sendCommand(command, { enter: true });
      const children = parseListOutput(output as string, path);

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
      setRootFiles(updateFilesWithChildren(rootFiles));
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
      setRootFiles(updateFilesOnError(rootFiles));
    }
  };

  const downloadFile = async (filePath: string) => {
    const fileName = filePath.split("/").pop() || "download";
    const downloadDir = `${process.env.HOME || "~"}/Downloads`;

    const command = `${kubectlPath} cp ${pod.getNs()}/${pod.getName()}:${filePath} ${downloadDir}/${fileName} -c ${container.name}`;

    createTerminalTab({
      title: `Download: ${fileName}`,
      id: `download-${Date.now()}`,
    });

    try {
      await sendCommand(command, { enter: true });
      alert(`File downloaded to ~/Downloads/${fileName}`);
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    hideDetails();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "white",
        border: "1px solid #ccc",
        borderRadius: "8px",
        padding: "20px",
        zIndex: 10000,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
        minWidth: "650px",
        maxHeight: "85vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h3 style={{ margin: 0 }}>File Explorer</h3>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            fontSize: "20px",
            cursor: "pointer",
            padding: "0",
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ marginBottom: "12px", fontSize: "12px", color: "#666" }}>
        <strong>Pod:</strong> {pod.getName()} | <strong>Namespace:</strong> {pod.getNs()} | <strong>Container:</strong> {container.name}
      </div>

      {error && (
        <div style={{ marginBottom: "12px", padding: "8px", background: "#ffebee", color: "#c62828", borderRadius: "4px", fontSize: "12px" }}>
          Error: {error}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", border: "1px solid #e0e0e0", borderRadius: "4px", background: "#fafafa" }}>
        {loading ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>
            Loading files...
          </div>
        ) : rootFiles.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#999" }}>
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

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "12px" }}>
        <button
          onClick={onClose}
          style={{
            padding: "8px 16px",
            background: "#f0f0f0",
            border: "1px solid #ccc",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
};

const NonInjectablePodFileExplorerMenu: React.FC<PodFileExplorerMenuProps & Dependencies> = (props) => {
  const { object, toolbar, createTerminalTab, sendCommand, hideDetails } = props;
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
  const statuses = pod.getContainerStatuses();

  if (!containers || !containers.length) return null;

  const handleOpenExplorer = (container: Container | EphemeralContainer) => {
    setSelectedContainer(container);
    setShowExplorer(true);
  };

  return (
    <>
      <PodMenuItem
        material="folder_open"
        title="File Explorer"
        tooltip="File Explorer"
        toolbar={toolbar}
        containers={containers}
        statuses={statuses}
        onMenuItemClick={handleOpenExplorer}
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
            sendCommand={sendCommand}
            createTerminalTab={createTerminalTab}
            hideDetails={hideDetails}
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
              background: "rgba(0, 0, 0, 0.5)",
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
      createTerminalTab: di.inject(createTerminalTabInjectable),
      sendCommand: di.inject(sendCommandInjectable),
      hideDetails: di.inject(hideDetailsInjectable),
    }),
  }
);
