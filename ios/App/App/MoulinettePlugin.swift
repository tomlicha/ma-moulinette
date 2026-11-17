import AuthenticationServices
import Capacitor
import UIKit

/// Plugin propre à Ma Moulinette, appelé depuis la page par `src/native/shell.ts` (nom JavaScript : `Moulinette`).
/// Enregistré par `MainViewController`.
@objc(MoulinettePlugin)
public class MoulinettePlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "MoulinettePlugin"
    public let jsName = "Moulinette"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise)
    ]

    /// Gardée tant qu'elle est ouverte : sans référence, la session se fermerait aussitôt.
    private var authSession: ASWebAuthenticationSession?

    /// Écran allumé pendant la sortie : on ne touche pas l'iPad pendant une séance ERG.
    @objc func keepAwake(_ call: CAPPluginCall) {
        let on = call.getBool("on", false)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }

    /// Connexion dans une session d'authentification système (Google refuse les WebView intégrées).
    /// Rend l'adresse de retour (`moulinette://auth?ticket=…`), que la page échange contre sa session.
    @objc func authenticate(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = call.getString("callbackScheme") else {
            call.reject("url et callbackScheme sont requis")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callback, error in
                self?.authSession = nil
                if let callback = callback {
                    call.resolve(["url": callback.absoluteString])
                } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    call.reject("cancelled", "CANCELLED")
                } else {
                    call.reject(error?.localizedDescription ?? "connexion impossible")
                }
            }
            session.presentationContextProvider = self
            // Partage les cookies de Safari : un coureur déjà connecté à Strava n'a pas à retaper son mot de passe.
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() {
                self.authSession = nil
                call.reject("session d'authentification impossible à ouvrir")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }
}
