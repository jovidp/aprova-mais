// Inicializador do Aprova+ para Windows.
// Sobe o servidor de produção (next start) desta pasta, espera ficar pronto
// e abre o app numa janela própria do Edge/Chrome. Fechar esta janela encerra o servidor.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Windows.Forms;

static class AprovaMais
{
    const int Porta = 3000;
    static readonly string Url = "http://localhost:" + Porta;
    static Process servidor;

    [STAThread]
    static void Main()
    {
        Application.EnableVisualStyles();
        string pasta = LocalizarProjeto();
        if (pasta == null)
        {
            MessageBox.Show("Não encontrei a pasta do projeto (package.json). Deixe o AprovaMais.exe dentro da pasta do sistema.", "Aprova+", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var janela = new Form { Text = "Aprova+", Width = 420, Height = 170, FormBorderStyle = FormBorderStyle.FixedSingle, MaximizeBox = false, StartPosition = FormStartPosition.CenterScreen };
        try { janela.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        var status = new Label { Left = 16, Top = 16, Width = 380, Height = 40, Text = "Iniciando o servidor…" };
        var abrir = new Button { Left = 16, Top = 70, Width = 180, Height = 32, Text = "Abrir o Aprova+", Enabled = false };
        var sair = new Button { Left = 212, Top = 70, Width = 180, Height = 32, Text = "Encerrar" };
        abrir.Click += (s, e) => AbrirApp();
        sair.Click += (s, e) => janela.Close();
        janela.Controls.AddRange(new Control[] { status, abrir, sair });
        janela.FormClosing += (s, e) => EncerrarServidor();

        janela.Shown += (s, e) => new Thread(() =>
        {
            try
            {
                if (!Responde())
                {
                    if (!Directory.Exists(Path.Combine(pasta, ".next")) || !File.Exists(Path.Combine(pasta, ".next", "BUILD_ID")))
                    {
                        Atualizar(janela, status, "Primeira execução: compilando (pode levar alguns minutos)…");
                        Executar(pasta, "npm run build", true);
                    }
                    Atualizar(janela, status, "Iniciando o servidor…");
                    servidor = Executar(pasta, "npm run start -- -p " + Porta, false);
                    for (int i = 0; i < 90 && !Responde(); i++) Thread.Sleep(1000);
                }
                if (!Responde()) { Atualizar(janela, status, "O servidor não respondeu. Verifique se o Node.js está instalado."); return; }
                Atualizar(janela, status, "Rodando em " + Url + "\nFeche esta janela para encerrar o servidor.");
                janela.BeginInvoke((Action)(() => { abrir.Enabled = true; AbrirApp(); }));
            }
            catch (Exception ex) { Atualizar(janela, status, "Erro: " + ex.Message); }
        }) { IsBackground = true }.Start();

        Application.Run(janela);
    }

    static string LocalizarProjeto()
    {
        var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        for (int i = 0; i < 4 && dir != null; i++, dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "package.json")) && Directory.Exists(Path.Combine(dir.FullName, "src"))) return dir.FullName;
        return null;
    }

    static Process Executar(string pasta, string comando, bool esperar)
    {
        var p = Process.Start(new ProcessStartInfo("cmd.exe", "/c " + comando) { WorkingDirectory = pasta, CreateNoWindow = true, UseShellExecute = false });
        if (esperar) p.WaitForExit();
        return p;
    }

    static bool Responde()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(Url + "/api/health");
            req.Timeout = 2000;
            using (var r = (HttpWebResponse)req.GetResponse()) return r.StatusCode == HttpStatusCode.OK;
        }
        catch { return false; }
    }

    static void AbrirApp()
    {
        string destino = Url + "/dashboard";
        string[] navegadores = {
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            Environment.ExpandEnvironmentVariables(@"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        };
        foreach (var n in navegadores)
            if (File.Exists(n)) { Process.Start(n, "--app=" + destino); return; }
        Process.Start(new ProcessStartInfo(destino) { UseShellExecute = true });
    }

    static void EncerrarServidor()
    {
        if (servidor == null || servidor.HasExited) return;
        try { Process.Start(new ProcessStartInfo("taskkill", "/PID " + servidor.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false }).WaitForExit(5000); } catch { }
    }

    static void Atualizar(Form f, Label l, string texto)
    {
        try { f.BeginInvoke((Action)(() => l.Text = texto)); } catch { }
    }
}
