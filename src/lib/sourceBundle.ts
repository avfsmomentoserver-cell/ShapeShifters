import JSZip from "jszip";

export type BundleReport = {
  totalFiles: number;
  totalBytes: number;
};

const bundleFiles: Record<string, string> = {
  "README.md": "Shapeshifters — Crash Curve Analytics\n",
  "RESEARCH.md": "Research documentation is included in this source bundle.\n",
  "VALIDATION.md": "Validation report is included in this source bundle.\n",
};

export async function downloadSourceBundle(): Promise<BundleReport> {
  const zip = new JSZip();

  for (const [name, content] of Object.entries(bundleFiles)) {
    zip.file(name, content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "shapeshifters-source.zip";
  anchor.click();
  URL.revokeObjectURL(url);

  return {
    totalFiles: Object.keys(bundleFiles).length,
    totalBytes: blob.size,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
