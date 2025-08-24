import { serveDir, serveFile } from "jsr:@std/http@1.0.16/file-server";
import { qrPng } from "jsr:@sigmasd/qrpng@0.1.3";
import { basename } from "jsr:@std/path@1/basename";

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

if (import.meta.main) {
  let filePath: string | null = null;
  let textContent: string | null = null;
  let qrPath: string;
  let isSharing: boolean = true;

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
        break;
      case "text":
        textContent = event.data.content;
        filePath = null; // Reset file path when text is shared
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
    }
  };
}
