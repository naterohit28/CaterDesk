using System;
using System.IO;
using System.Text;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Diagnostics;
using System.Windows.Forms;
using System.Drawing;

// Small Windows test launcher. Edge supplies the browser engine; all app assets
// are served locally. No Node/Python installation or administrator rights needed.
internal static class FlavorFusionDesktop {
    const int Port = 19891;
    const string Url = "http://127.0.0.1:19891/";
    static readonly string Root = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"));
    static TcpListener listener;
    static NotifyIcon tray;
    static Mutex singleInstance;
    static string edge;
    [STAThread]
    static void Main() {
        bool created;
        singleInstance = new Mutex(true, "Local\\FlavorFusionDesktopTest", out created);
        Application.EnableVisualStyles();
        edge = FindEdge();
        if (!created) {
            // Opening a newly downloaded EXE must not silently show an old server.
            try {
                var request = (HttpWebRequest)WebRequest.Create(Url + "health");
                request.Timeout = 3000; request.Proxy = null;
                using (var response = request.GetResponse())
                using (var reader = new StreamReader(response.GetResponseStream())) {
                    if (!reader.ReadToEnd().Contains("\"version\":\"4.18.1\"")) {
                        MessageBox.Show("An older desktop app is still running. Choose Exit test server from its system-tray icon, then run CaterDesk again. Your records stay in the same data profile.", "CaterDesk update required");
                        return;
                    }
                }
            } catch (Exception) {
                MessageBox.Show("Another desktop app is starting or still running. Exit its system-tray test server, then run CaterDesk again.", "CaterDesk already running");
                return;
            }
            Open(); return;
        }
        if (edge == null) { MessageBox.Show("Microsoft Edge is required for this desktop test app.", "CaterDesk Desktop Test"); return; }
        if (!File.Exists(Path.Combine(Root, "index.html"))) { MessageBox.Show("Extract the entire ZIP first. Keep the app folder beside this executable.", "CaterDesk Desktop Test"); return; }
        try {
            listener = new TcpListener(IPAddress.Loopback, Port); listener.Start();
            var thread = new Thread(Serve); thread.IsBackground = true; thread.Start();
        } catch (Exception e) { MessageBox.Show("Cannot open the local test server. Close another desktop test copy and retry.\n" + e.Message, "CaterDesk Desktop Test"); return; }
        tray = new NotifyIcon(); tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Text = "CaterDesk Desktop Test v4.18.1";
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open CaterDesk", null, delegate { Open(); });
        menu.Items.Add("About test storage", null, delegate { MessageBox.Show("This desktop test app uses a separate Edge profile. Its records are local to this computer and do not sync with your phone. Use Share/save backup before moving records.\n\nData folder:\n" + Profile(), "CaterDesk Desktop Test v4.18.1"); });
        menu.Items.Add("Exit test server", null, delegate { Application.Exit(); });
        tray.ContextMenuStrip = menu; tray.DoubleClick += delegate { Open(); }; tray.Visible = true;
        Application.ApplicationExit += delegate { tray.Visible = false; tray.Dispose(); listener.Stop(); singleInstance.ReleaseMutex(); };
        if (Environment.GetEnvironmentVariable("FF_DESKTOP_NO_OPEN") != "1") Open();
        Application.Run();
    }
    static string Profile() { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FlavorFusionDesktopTest", "EdgeProfile"); }
    static string FindEdge() {
        string[] candidates = { Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"), Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe") };
        foreach (var path in candidates) if (File.Exists(path)) return path;
        return null;
    }
    static void Open() {
        if (edge == null) return;
        Directory.CreateDirectory(Profile());
        var start = new ProcessStartInfo(edge, "--app=" + Url + " --user-data-dir=\"" + Profile() + "\" --no-first-run --no-default-browser-check --disable-background-mode");
        start.UseShellExecute = false;
        try { Process.Start(start); } catch (Exception e) { MessageBox.Show(e.Message, "Could not open Edge"); }
    }
    static void Serve() {
        try { while (true) { var client = listener.AcceptTcpClient(); ThreadPool.QueueUserWorkItem(delegate { Handle(client); }); } }
        catch (SocketException) { } catch (ObjectDisposedException) { }
    }
    static void Handle(TcpClient client) {
        using (client) {
            client.ReceiveTimeout = 5000; client.SendTimeout = 5000;
            try {
                using (var stream = client.GetStream()) {
                    var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
                    var first = reader.ReadLine(); if (first == null) return;
                    var parts = first.Split(' '); if (parts.Length != 3) return;
                    string host = "", line; int bytes = first.Length;
                    while (!String.IsNullOrEmpty(line = reader.ReadLine())) { bytes += line.Length; if (bytes > 16384) return; if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim(); }
                    if (host != "127.0.0.1:" + Port) { Reply(stream, 403, "text/plain", Encoding.UTF8.GetBytes("Forbidden"), false); return; }
                    bool head = parts[0] == "HEAD";
                    if (parts[0] != "GET" && !head) { Reply(stream, 405, "text/plain", Encoding.UTF8.GetBytes("GET and HEAD only"), false); return; }
                    var raw = parts[1].Split('?')[0]; var path = Uri.UnescapeDataString(raw);
                    if (path == "/health") { Reply(stream, 200, "application/json", Encoding.UTF8.GetBytes("{\"app\":\"FlavorFusionDesktopTest\",\"version\":\"4.18.1\"}"), head); return; }
                    foreach (var segment in path.Split('/')) if (segment.StartsWith(".")) { Reply(stream, 403, "text/plain", new byte[0], head); return; }
                    if (path == "/") path = "/index.html";
                    var file = Path.GetFullPath(Path.Combine(Root, path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
                    var mime = Mime(Path.GetExtension(file));
                    if (!file.StartsWith(Root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || mime == null || !File.Exists(file)) { Reply(stream, 404, "text/plain", new byte[0], head); return; }
                    Reply(stream, 200, mime, File.ReadAllBytes(file), head);
                }
            } catch (IOException) { } catch (Exception) { }
        }
    }
    static string Mime(string ext) {
        switch (ext.ToLowerInvariant()) { case ".html": return "text/html; charset=utf-8"; case ".js": return "text/javascript; charset=utf-8"; case ".css": return "text/css; charset=utf-8"; case ".json": return "application/json"; case ".png": return "image/png"; default: return null; }
    }
    static void Reply(Stream stream, int status, string type, byte[] body, bool head) {
        string headers = "HTTP/1.1 " + status + " " + (status == 200 ? "OK" : "Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nContent-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'\r\n\r\n";
        var data = Encoding.ASCII.GetBytes(headers); stream.Write(data, 0, data.Length); if (!head) stream.Write(body, 0, body.Length);
    }
}
