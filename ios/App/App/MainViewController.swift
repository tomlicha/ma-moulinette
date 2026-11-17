import Capacitor
import UIKit

/// Contrôleur de la WebView : celui de Capacitor, plus le plugin propre à l'application.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MoulinettePlugin())
    }
}
