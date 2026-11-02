# Google Gemini

## Présentation

Cette intégration fait tourner l’assistant de Gladys sur **Google Gemini**, via l’API Gemini officielle et votre propre clé d’API Google AI Studio. Une fois choisie dans **Paramètres → Intelligence artificielle**, toutes les requêtes d’IA de Gladys partent vers Gemini : le chat et les appareils qu’il pilote, les scènes qu’il crée, l’action de scène « demander à l’IA » et le résumé hebdomadaire. Elle fonctionne avec ou sans compte Gladys Plus, et l’offre gratuite de l’API Gemini suffit pour commencer.

Elle ajoute aussi deux déclencheurs de scène (l’assistant est en erreur, l’assistant répond de nouveau) et un widget de tableau de bord sur votre consommation.

Non affiliée à Google. Pas encore testée avec une vraie clé Gemini : vos retours sont les bienvenus.

## Prérequis

- Gladys Assistant 5.3.0 ou plus récent.
- Un compte Google et une clé d’API Gemini : [Google AI Studio](https://aistudio.google.com/apikey), **Create API key**.
- **Offre gratuite** : suffisante pour une maison, avec des limites basses par minute et par jour (visibles dans AI Studio, Rate limit) ; Gemini 4 Argon n’en fait pas partie. **Avec un compte de facturation** (offre payante) : limites plus hautes, tous les modèles, facturation au jeton.
- **Vos données** : hors de l’Espace économique européen, de la Suisse et du Royaume-Uni, Google peut utiliser les requêtes de l’offre gratuite pour améliorer ses produits, et des personnes peuvent les lire. Dans ces pays, et partout avec un compte de facturation, ce n’est pas le cas. L’intégration envoie chaque requête avec la journalisation coupée (`store: false`).
- Ce qui sort de chez vous : chaque message du chat, l’historique, les outils que Gladys propose et leurs résultats (l’état des appareils que Gemini consulte) et les images du chat partent chez Google en HTTPS. Les réponses de Gemini pilotent vos appareils et créent des scènes.

## Configuration

| Champ ou bouton                          | Défaut                | Rôle                                                                                   |
| ---------------------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| Clé d’API Gemini                         | —                     | Obligatoire. Plus jamais affichée, jamais journalisée                                  |
| Modèle du chat                           | Gemini 3.8 Flash      | Répond au chat, crée les scènes, rédige le résumé hebdomadaire                         |
| Modèle du routeur                        | Gemini 3.5 Flash-Lite | Trie chaque message avant la réponse et doit répondre en moins de 20 secondes          |
| Identifiant de l’autre modèle            | —                     | Seulement si un modèle est sur « Autre modèle » : l’identifiant exact (appel d’outils) |
| Réflexion du modèle du chat              | Moyenne               | Plus de réflexion, de meilleures scènes, des réponses plus lentes et plus chères       |
| Longueur maximale d’une réponse (jetons) | 16000                 | Réflexion comprise ; Google conseille 32768 pour Gemini 4 Argon                        |
| Tester la connexion                      | —                     | Une courte réponse de chaque modèle avec son temps ; consomme quelques jetons          |

L’état de l’écran de configuration indique si Google accepte la clé et les deux modèles, sans consommer de jeton. Lire un modèle ne prouve pas que votre projet peut générer (offre gratuite indisponible, facturation à configurer) : **Tester la connexion** le vérifie.

## Utilisation

1. Intégrations → **Google Gemini** → Configuration : collez la clé d’API, gardez les modèles par défaut, appuyez sur **Tester la connexion**.
2. Paramètres → **Intelligence artificielle** : choisissez **Google Gemini**.
3. Parlez à Gladys dans le chat : « allume le salon », « quelle température dans la chambre ? », « crée une scène qui ferme les volets au coucher du soleil ».

### Choisir les modèles

- **Gemini 3.8 Flash** (défaut du chat) : le modèle le plus capable de l’offre gratuite, bon pour appeler des outils et créer des scènes.
- **Gemini 4 Argon** : le plus capable, seulement pour un projet avec facturation.
- **Gemini 3.6 Flash** : le Flash précédent, toujours pris en charge.
- **Gemini 3.5 Flash-Lite** (routeur par défaut) et **Gemini 3.1 Flash-Lite** : rapides et peu chers ; moins fiables pour créer des scènes. Google prévoit d’arrêter 3.1 Flash-Lite en mai 2027.
- **Autre modèle** : un modèle Gemini plus récent ou une préversion. S’il refuse le niveau de réflexion, l’intégration l’envoie ensuite sans.

Gemini réfléchit toujours un peu : **minimale** est le moins, et Gemini 3.8 Flash et Gemini 4 Argon commencent à **faible**. Le routeur utilise toujours la réflexion la plus faible que son modèle accepte.

### Widget de tableau de bord

Le widget **Conso Gemini** affiche les requêtes et jetons du jour, les jetons du mois, les erreurs du jour, les jetons par jour sur 30 jours, si Gemini répond, la dernière requête et la dernière erreur. Il compte ce que Gladys a demandé, réflexion comprise ; Google AI Studio reste la référence pour la facture.

![Le widget de consommation : requêtes et jetons du jour, jetons du mois, erreurs, jetons par jour, dernière requête et dernière erreur (illustration générée, pas une capture d’écran)](https://raw.githubusercontent.com/William-De71/gladys-google-gemini/main/docs/assets/widgets.fr.png)

### Scènes

- **Déclencheur « Gemini : l’assistant est en erreur »** : une fois par panne (clé refusée, facturation ou offre gratuite, limite de requêtes, modèle indisponible, API injoignable, trop lent, erreur Gemini), avec le type, le message, la requête et le modèle.
- **Déclencheur « Gemini : l’assistant répond de nouveau »** : la première réponse après une panne, avec les minutes de panne.

Exemples : quand l’assistant est en erreur à cause de la limite de requêtes, envoyer un message Telegram à l’administrateur ; quand il répond de nouveau, en envoyer un autre avec les minutes de panne.

Il n’y a pas d’action de recherche web : les conditions de l’ancrage dans la recherche Google imposent d’afficher les suggestions de recherche de Google avec chaque réponse, ce qu’une notification de scène ne peut pas faire.

## Dépannage

- **« Google a refusé la clé d’API »** : recopiez la clé depuis Google AI Studio ; une clé supprimée, ou signalée comme divulguée, donne le même message.
- **« Google refuse de faire tourner … pour ce projet »** : l’offre gratuite n’est pas disponible pour ce projet, ou le compte de facturation demande une action ; ouvrez Google AI Studio, Billing.
- **« Limite de requêtes atteinte »** : l’offre gratuite accepte peu de requêtes par minute et par jour (par projet, remises à zéro à minuit, heure du Pacifique). Un tour de chat fait au moins deux requêtes. Patientez, choisissez un routeur plus léger, ou liez un compte de facturation.
- **« … n’est pas disponible pour cette clé d’API »** : le modèle n’existe pas, ou a été arrêté ; choisissez-en un autre.
- **Le chat répond sans rien faire** : essayez Gemini 3.8 Flash avec une réflexion moyenne ; les Flash-Lite sont moins fiables avec beaucoup d’outils.
- **« The answer was cut at max_tokens »** (message en anglais) : augmentez la longueur maximale d’une réponse, ou baissez la réflexion.
- **« Gemini stopped the answer (SAFETY) »** (message en anglais) : les filtres de Google ont bloqué la requête ou la réponse ; reformulez-la.
- Journaux : Paramètres → Supervision, journaux de l’intégration. Ne partagez jamais votre clé d’API.
