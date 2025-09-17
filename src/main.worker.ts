import { serveDir, serveFile } from "jsr:@std/http@1.0.16/file-server";
import { qrPng } from "jsr:@sigmasd/qrpng@0.1.3";
import { basename } from "jsr:@std/path@1/basename";
import { join } from "jsr:@std/path@1/join";
import { ensureDir } from "jsr:@std/fs@1.0.12/ensure-dir";

function getLocalAddr() {
  return Deno.networkInterfaces().filter((int) =>
    int.name !== "lo" && int.family === "IPv4"
  ).at(0)?.address || "localhost";
}

const emptyPage = `\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>No Content Found</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: #f0f0f0;
    }
    .message {
      text-align: center;
      padding: 20px;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <div class="message">
    <h1>No Content Found</h1>
    <p>Please drop a file or paste text in the application first.</p>
  </div>
</body>
</html>`;

const errorPage = `\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Access Error</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f0f0f0;
        }
        .error-container {
            max-width: 600px;
            padding: 2rem;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .error-title {
            color: #dc3545;
            margin-bottom: 1rem;
        }
        .solution {
            margin-top: 1rem;
            padding: 1rem;
            background-color: #f8f9fa;
            border-radius: 4px;
        }
        .steps {
            margin-top: 1rem;
            padding-left: 1.5rem;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h1 class="error-title">File Access Error</h1>
        <p>The application couldn't access the file. This could be due to several reasons:</p>
        <ul>
            <li>The file might have been moved or deleted</li>
            <li>You might not have the necessary permissions to read the file</li>
            <li>If you're using Flatpak, it might be due to sandbox restrictions</li>
        </ul>

        <div class="solution">
            <h2>Possible solutions:</h2>
            <ul>
                <li>Verify that the file still exists and try sharing it again</li>
                <li>If you're using Flatpak, you can try granting file access permissions using Flatseal:
                    <ol class="steps">
                        <li>Install Flatseal</li>
                        <li>Open Flatseal and find "Share" in the application list</li>
                        <li>Under "Filesystem", enable access to your home directory</li>
                    </ol>
                </li>
            </ul>
        </div>

        <p>Error details: {{ERROR_MESSAGE}}</p>
    </div>
</body>
</html>`;

const uploadPage = `\
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>File Upload</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            padding: 2rem;
            max-width: 600px;
            width: 100%;
        }
        .header {
            text-align: center;
            margin-bottom: 2rem;
        }
        .header h1 {
            color: #333;
            margin-bottom: 0.5rem;
            font-size: 2rem;
        }
        .header p {
            color: #666;
            font-size: 1.1rem;
        }
        .upload-area {
            border: 3px dashed #ddd;
            border-radius: 15px;
            padding: 3rem 2rem;
            text-align: center;
            transition: all 0.3s ease;
            cursor: pointer;
            margin-bottom: 1.5rem;
        }
        .upload-area:hover {
            border-color: #667eea;
            background-color: #f8f9ff;
        }
        .upload-area.dragover {
            border-color: #667eea;
            background-color: #f0f4ff;
            transform: scale(1.02);
        }
        .upload-icon {
            font-size: 3rem;
            color: #ddd;
            margin-bottom: 1rem;
        }
        .upload-area.dragover .upload-icon {
            color: #667eea;
        }
        .upload-text {
            color: #666;
            font-size: 1.1rem;
            margin-bottom: 1rem;
        }
        .upload-area.dragover .upload-text {
            color: #667eea;
            font-weight: 600;
        }
        .file-input {
            display: none;
        }
        .select-button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 1rem;
            cursor: pointer;
            transition: transform 0.2s ease;
        }
        .select-button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }
        .progress-container {
            margin-top: 1.5rem;
            display: none;
        }
        .progress-bar {
            width: 100%;
            height: 8px;
            background-color: #f0f0f0;
            border-radius: 4px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            width: 0%;
            transition: width 0.3s ease;
        }
        .progress-text {
            text-align: center;
            margin-top: 0.5rem;
            color: #666;
            font-size: 0.9rem;
        }
        .file-list {
            margin-top: 1.5rem;
            max-height: 200px;
            overflow-y: auto;
        }
        .file-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 0.8rem;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 0.5rem;
        }
        .file-name {
            color: #333;
            font-weight: 500;
        }
        .file-size {
            color: #666;
            font-size: 0.9rem;
        }
        .success-message {
            background: #d4edda;
            color: #155724;
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
            display: none;
        }
        .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 1rem;
            border-radius: 8px;
            margin-top: 1rem;
            display: none;
        }
        .upload-button {
            background: #28a745;
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 1rem;
            cursor: pointer;
            width: 100%;
            margin-top: 1rem;
            display: none;
            transition: background-color 0.2s ease;
        }
        .upload-button:hover {
            background: #218838;
        }
        .upload-button:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📁 File Upload</h1>
            <p>Drag and drop files here or click to select</p>
        </div>

        <div class="upload-area" id="uploadArea">
            <div class="upload-icon">📤</div>
            <div class="upload-text">Drop files here or click to browse</div>
            <button class="select-button" onclick="document.getElementById('fileInput').click()">
                Select Files
            </button>
        </div>

        <input type="file" id="fileInput" class="file-input" multiple>

        <div class="file-list" id="fileList"></div>

        <button class="upload-button" id="uploadButton">Upload Files</button>

        <div class="progress-container" id="progressContainer">
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="progress-text" id="progressText">Uploading...</div>
        </div>

        <div class="success-message" id="successMessage">
            Files uploaded successfully!
        </div>

        <div class="error-message" id="errorMessage">
            Upload failed. Please try again.
        </div>
    </div>

    <script>
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const fileList = document.getElementById('fileList');
        const uploadButton = document.getElementById('uploadButton');
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const successMessage = document.getElementById('successMessage');
        const errorMessage = document.getElementById('errorMessage');

        let selectedFiles = [];

        // Drag and drop handlers
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files);
            handleFiles(files);
        });

        // Click to upload
        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', (e) => {
            const files = Array.from(e.target.files);
            handleFiles(files);
        });

        function handleFiles(files) {
            selectedFiles = files;
            displayFiles();
            if (files.length > 0) {
                uploadButton.style.display = 'block';
            }
        }

        function displayFiles() {
            fileList.innerHTML = '';
            selectedFiles.forEach(file => {
                const fileItem = document.createElement('div');
                fileItem.className = 'file-item';
                fileItem.innerHTML = \`
                    <span class="file-name">\${file.name}</span>
                    <span class="file-size">\${formatFileSize(file.size)}</span>
                \`;
                fileList.appendChild(fileItem);
            });
        }

        function formatFileSize(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        uploadButton.addEventListener('click', async () => {
            if (selectedFiles.length === 0) return;

            uploadButton.disabled = true;
            progressContainer.style.display = 'block';
            successMessage.style.display = 'none';
            errorMessage.style.display = 'none';

            const formData = new FormData();
            selectedFiles.forEach(file => {
                formData.append('files', file);
            });

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    progressFill.style.width = '100%';
                    progressText.textContent = 'Upload complete!';
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        successMessage.style.display = 'block';
                        selectedFiles = [];
                        fileList.innerHTML = '';
                        uploadButton.style.display = 'none';
                        fileInput.value = '';
                    }, 1000);
                } else {
                    throw new Error('Upload failed');
                }
            } catch (error) {
                progressContainer.style.display = 'none';
                errorMessage.style.display = 'block';
                console.error('Upload error:', error);
            } finally {
                uploadButton.disabled = false;
                progressFill.style.width = '0%';
            }
        });

        // Simulate progress (you can implement real progress tracking if needed)
        function simulateProgress() {
            let progress = 0;
            const interval = setInterval(() => {
                progress += Math.random() * 30;
                if (progress >= 95) {
                    progress = 95;
                    clearInterval(interval);
                }
                progressFill.style.width = progress + '%';
                progressText.textContent = \`Uploading... \${Math.round(progress)}%\`;
            }, 200);
        }
    </script>
</body>
</html>`;

if (import.meta.main) {
  let filePath: string | null = null;
  let textContent: string | null = null;
  let qrPath: string;
  let isSharing: boolean = true;
  let isReceiveMode: boolean = false;
  let downloadDir: string = join(Deno.env.get("HOME") || "/tmp", "Downloads");

  const startServer = () => {
    Deno.serve({
      port: 0,
      onListen: async (addr) => {
        const serverAddr = `http://${getLocalAddr()}:${addr.port}`;
        console.log("[worker] HTTP server running. Access it at:", serverAddr);
        await Deno.writeFile(
          qrPath,
          qrPng(new TextEncoder().encode(serverAddr)),
        );
        //@ts-ignore worker
        self.postMessage({ type: "start", url: serverAddr });
      },
    }, async (req): Promise<Response> => {
      // Disable caching
      const headers = new Headers({
        "Cache-Control":
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      });

      // If sharing is disabled, return a message
      if (!isSharing) {
        headers.set("Content-Type", "text/html");
        const stoppedPage = `\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sharing Stopped</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: #f0f0f0;
    }
    .message {
      text-align: center;
      padding: 20px;
      background-color: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      color: #dc3545;
    }
  </style>
</head>
<body>
  <div class="message">
    <h1>🛑 Sharing Stopped</h1>
    <p>The server is currently not sharing any content.</p>
    <p>Please enable sharing in the application to access files.</p>
  </div>
</body>
</html>`;
        return new Response(stoppedPage, {
          status: 503,
          headers: headers,
        });
      }

      // Handle file upload in receive mode
      if (
        isReceiveMode && req.method === "POST" &&
        new URL(req.url).pathname === "/upload"
      ) {
        try {
          const formData = await req.formData();
          const files = formData.getAll("files") as File[];

          // Ensure download directory exists
          await ensureDir(downloadDir);

          for (const file of files) {
            if (file && file.size > 0) {
              const filePath = join(downloadDir, file.name);
              const arrayBuffer = await file.arrayBuffer();
              await Deno.writeFile(filePath, new Uint8Array(arrayBuffer));
              console.log(`[worker] File saved: ${filePath}`);
            }
          }

          return new Response("Upload successful", {
            status: 200,
            headers: { "Content-Type": "text/plain" },
          });
        } catch (error) {
          console.error("[worker] Upload error:", error);
          return new Response("Upload failed", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          });
        }
      }

      // In receive mode, serve the upload page
      if (isReceiveMode) {
        headers.set("Content-Type", "text/html");
        return new Response(uploadPage, { headers });
      }

      if (!filePath && !textContent) {
        headers.set("Content-Type", "text/html");
        return new Response(emptyPage, {
          status: 404,
          headers: headers,
        });
      }

      if (textContent) {
        console.log("[worker] serving text content");
        return new Response(textContent, { headers });
      }

      if (filePath) {
        console.log("[worker] serving path:", filePath);
        try {
          const meta = await Deno.stat(filePath);
          let response: Response;
          let responseHeaders: Headers;
          if (meta.isFile) {
            response = await serveFile(req, filePath);
            // Clone headers from the original response
            responseHeaders = new Headers(response.headers);

            // Suggest original filename for downloads
            const filename = basename(filePath);
            const encodedFilename = encodeURIComponent(filename);
            headers.set(
              "content-disposition",
              `attachment; filename*=UTF-8''${encodedFilename}`,
            );
          } else {
            response = await serveDir(req, {
              fsRoot: filePath,
              showDirListing: true,
              showIndex: false,
            });
            // Clone headers from the original response
            responseHeaders = new Headers(response.headers);
          }

          // Update headers with the custom headers
          headers.forEach((value, key) => {
            responseHeaders.set(key, value);
          });

          // Return the new response with the updated headers
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        } catch (error) {
          console.error("[worker] Error accessing file:", error);
          headers.set("Content-Type", "text/html");
          return new Response(
            errorPage.replace(
              "{{ERROR_MESSAGE}}",
              error instanceof Error ? error.message : String(error),
            ),
            { status: 404, headers },
          );
        }
      }

      // This should never happen, but just in case
      return new Response("Internal Server Error", { status: 500, headers });
    });
  };

  //@ts-ignore worker
  self.onmessage = (event) => {
    console.log("[worker] received msg:", event.data);
    switch (event.data.type) {
      case "file":
        filePath = event.data.path;
        textContent = null; // Reset text content when a file is shared
        isReceiveMode = false; // Switch to share mode when sharing a file
        break;
      case "text":
        textContent = event.data.content;
        filePath = null; // Reset file path when text is shared
        isReceiveMode = false; // Switch to share mode when sharing text
        break;
      case "qrPath":
        qrPath = event.data.path;
        startServer();
        break;
      case "start-sharing":
        console.log("[worker] Starting sharing");
        isSharing = true;
        break;
      case "stop-sharing":
        console.log("[worker] Stopping sharing");
        isSharing = false;
        break;
      case "set-receive-mode":
        console.log("[worker] Setting receive mode:", event.data.enabled);
        isReceiveMode = event.data.enabled;
        if (isReceiveMode) {
          filePath = null;
          textContent = null;
        }
        break;
      case "set-download-dir":
        console.log("[worker] Setting download directory:", event.data.path);
        downloadDir = event.data.path;
        break;
    }
  };
}
