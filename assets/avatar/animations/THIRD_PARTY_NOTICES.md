# Third-party motion notices

The four `rocketbox-*.vrma` files in this directory were selected from the
Rocketbox family converted by Hanami. The applicable upstream notice is preserved below.

## 4. Microsoft Rocketbox — MIT License

**Trente-huit fichiers** — tous préfixés `rb-` — dérivent des animations de
**Microsoft Rocketbox** (`microsoft/Microsoft-Rocketbox`,
`Assets/Animations/all_animations_max_motextr_static/`), publiées sous **licence
MIT** en 2020. C'est une **famille de face à face complète et alternative** à
celle d'Overte : ses propres socles de repos, ses propres socles de parole, ses
propres gestes — et un rôle qu'Overte n'a pas du tout, le socle d'**écoute**.

Elle ne remplace rien : les deux familles cohabitent dans le dossier, et chaque
personnage choisit la sienne (réglage `animations` de son `character.json`).
**Elles ne se mélangent jamais** — voir la règle des familles dans
[`README.md`](README.md#deux-familles-de-face-à-face).

*Thirty-eight files — all prefixed `rb-` — derive from the **Microsoft
Rocketbox** avatar animations, released under the **MIT License** in 2020. They
form a complete **alternative face-to-face family** to Overte's: its own idles,
its own talking idles, its own gestures — and one role Overte does not have at
all, a **listening** base. The two families coexist in the folder and never mix;
each character picks one.*

```
MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

SPDX-License-Identifier : `MIT`
Dépôt / repository : <https://github.com/microsoft/Microsoft-Rocketbox>
Commit épinglé / pinned commit : `0943055db6ec570bcef9f2c8b41c9e5467c808f9`

Le dépôt distribue avatars et animations sous la même MIT ; le fichier `LICENSE`
racine est la seule licence qu'il porte. Une **demande de confirmation** a été
posée en amont par le propriétaire du projet — issue
[`microsoft/Microsoft-Rocketbox#24`](https://github.com/microsoft/Microsoft-Rocketbox/issues/24) —
et reste ouverte : elle est conservée ici comme trace de bonne foi, **elle n'est
pas une condition** de la licence. La MIT n'exige que la reproduction de l'avis
de copyright et du texte de permission ci-dessus, ce que fait ce fichier.

*The repository ships avatars and animations under the same MIT licence. A
good-faith request for confirmation was filed upstream (issue #24) and is kept
here as a record; it is not a condition of the licence, which only requires the
copyright notice and permission text reproduced above.*

### Comment ils ont été produits / how they were made

Le convertisseur est livré : [`scripts/convert-rocketbox.mjs`](../scripts/convert-rocketbox.mjs),
et le plan qui le pilote [`scripts/rocketbox-plan.json`](../scripts/rocketbox-plan.json)
— source, famille, fenêtre, boucle, rôle et mesures de chacun des 38 clips. Les
FBX d'origine (243 Mo, 77 fichiers) ne sont pas versionnés ; script + plan les
refabriquent à l'octet près depuis le commit épinglé. Les deux fichiers portent
leur empreinte SHA-256, recalculée à chaque exécution.

Quatre écarts avec le rig Mixamo d'Overte ont demandé un traitement, tous
consignés dans l'en-tête du script : le rig **Biped 3ds Max n'expose pas de
T-pose** (elle est synthétisée depuis la pose d'ancrage de la bibliothèque, par
la rotation minimale qui amène chaque os sur sa cible — la paume tombe alors
d'elle-même vers le bas, convention VRM) ; la **hiérarchie Biped n'est pas celle
du humanoïde VRM** (clavicules au cou, cuisses au buste : le squelette exporté
est reconstruit à la forme VRM, sans quoi les bras suivent le cou de 22°) ; le
**bassin n'est pas la racine** (`Bip01` porte la hauteur, `Bip01_Pelvis` est le
vrai bassin) ; et la rest pose exportée est **toujours la station debout** de la
famille, parce que `restHipsPosition` est une position monde par laquelle la
bibliothèque divise toute la piste.

Aucune retouche géométrique n'a été appliquée aux clips retenus : leurs raccords
tombent d'eux-mêmes, comme pour Overte, **parce qu'ils viennent tous du même
personnage et de la même pose d'ancrage** — identique à 0,09° près dans les 34
fichiers de la famille, et identique à la première comme à la dernière image de
chaque clip. Seule la **fenêtre** a été choisie, clip par clip. Les yeux et la
mâchoire, pourtant mappables, sont volontairement **hors export** : le regard
appartient au moteur (`client/src/scene/gaze.ts`) et la bouche au lipsync.

*The converter and its plan ship with the clips; the original FBX files do not.
No geometric retouching was needed — every clip comes from the same character
and the same anchor pose (identical to within 0.09° across the family), so the
seams fall into place on their own. Only the window was chosen, clip by clip.*

### Les mesures qui ont décidé / the measurements that decided

Mêmes critères que la règle d'acceptation du face à face (voir
[`README.md`](README.md#la-règle-dacceptation-chiffrée)), appliqués **contre le
socle de la famille Rocketbox** :

- raccord au socle `rb-idle` : **0,2 à 5,7 cm**, médiane **0,4** (seuil 10) ;
- couture des dix boucles : **0 à 2,22 cm** ;
- **raccord croisé contre le socle d'Overte : 16,5 à 20,3 cm** — deux fois et
  demie le seuil. C'est le chiffre qui interdit le mélange, et c'est pour lui
  que la règle des familles existe.

Sur 56 candidats, **18 ont été écartés** : six pour raccord (10,4 à 45,6 cm),
sept pour **redondance** avec un clip déjà retenu (jusqu'à 1,8° d'écart moyen —
le même geste rejoué), un pour un 95ᵉ centile de vitesse à 1025 °/s, deux hors
fourchette de raccord, deux enfin pour un pic pris en plein fondu d'entrée. Le
détail est dans le plan livré.

### Les trente-huit clips / the thirty-eight clips

| Fichier dérivé | Animation source Rocketbox | Segment repris |
| --- | --- | --- |
| `rb-idle.vrma` | `f_idle_breathe_02.max.fbx` | 0,033 → 9,933 s |
| `rb-idle-2.vrma` | `f_idle_neutral_02.max.fbx` | intégralité (11,233 s) |
| `rb-idle-3.vrma` | `f_idle_neutral_03.max.fbx` | 3,4 → 16,033 s |
| `rb-idle-4.vrma` | `f_idle_neutral_04.max.fbx` | 5,2 → 19,2 s |
| `rb-idle-talking.vrma` | `f_gestic_talk_neutral_01.max.fbx` | 10,7 → 18,633 s |
| `rb-idle-talking-2.vrma` | `f_gestic_talk_relaxed_02.max.fbx` | 17,967 → 24,467 s |
| `rb-idle-talking-3.vrma` | `f_gestic_talk_relaxed_01.max.fbx` | 19,7 → 26,8 s |
| `rb-listen.vrma` | `f_gestic_listen_accept_05.max.fbx` | 3,667 → 11,567 s |
| `rb-listen-2.vrma` | `f_gestic_listen_neutral_01.max.fbx` | 4,1 → 9,767 s |
| `rb-listen-3.vrma` | `f_gestic_listen_neutral_02.max.fbx` | 10,167 → 15,167 s |
| `rb-nod.vrma` | `f_gestic_listen_accept_01.max.fbx` | intégralité (2,033 s) |
| `rb-nod-2.vrma` | `f_gestic_listen_accept_02.max.fbx` | intégralité (2,133 s) |
| `rb-nod-3.vrma` | `f_gestic_listen_accept_04.max.fbx` | intégralité (5,267 s) |
| `rb-shake.vrma` | `f_gestic_listen_deny_01.max.fbx` | intégralité (3,167 s) |
| `rb-shake-2.vrma` | `f_gestic_listen_deny_04.max.fbx` | intégralité (3,500 s) |
| `rb-shake-3.vrma` | `f_gestic_listen_deny_05.max.fbx` | 10,7 → 14,233 s |
| `rb-wave.vrma` | `f_wave_01.max.fbx` | intégralité (5,533 s) |
| `rb-wave-2.vrma` | `f_wave_02.max.fbx` | intégralité (8,400 s) |
| `rb-shrug.vrma` | `f_gestic_shrug_01.max.fbx` | intégralité (1,833 s) |
| `rb-shrug-2.vrma` | `f_gestic_shrug_02.max.fbx` | intégralité (4,667 s) |
| `rb-laugh.vrma` | `f_gestic_laugh_low.max.fbx` | 0,6 → 6,6 s |
| `rb-think.vrma` | `f_gestic_thoughtful_01.max.fbx` | intégralité (9,433 s) |
| `rb-think-2.vrma` | `f_idle_scratch_head_01.max.fbx` | intégralité (4,000 s) |
| `rb-happy.vrma` | `f_cheer_03.max.fbx` | intégralité (3,167 s) |
| `rb-happy-2.vrma` | `f_cheer_04.max.fbx` | intégralité (6,667 s) |
| `rb-happy-3.vrma` | `f_cheer_05.max.fbx` | intégralité (6,667 s) |
| `rb-relaxed.vrma` | `f_idle_stretch_arms_01.max.fbx` | intégralité (7,300 s) |
| `rb-relaxed-2.vrma` | `f_idle_roll_head_02.max.fbx` | intégralité (4,600 s) |
| `rb-relaxed-3.vrma` | `f_idle_yawn_01.max.fbx` | intégralité (6,467 s) |
| `rb-relaxed-4.vrma` | `f_idle_waiting_01.max.fbx` | 0 → 5,067 s |
| `rb-neutral.vrma` | `f_idle_look_around_01.max.fbx` | intégralité (4,467 s) |
| `rb-neutral-2.vrma` | `f_idle_look_around_02.max.fbx` | intégralité (3,667 s) |
| `rb-neutral-3.vrma` | `f_idle_look_around_03.max.fbx` | intégralité (4,133 s) |
| `rb-neutral-4.vrma` | `f_idle_touch_hair_01.max.fbx` | intégralité (4,833 s) |
| `rb-neutral-5.vrma` | `f_idle_touch_face_01.max.fbx` | intégralité (5,567 s) |
| `rb-angry.vrma` | `f_gestic_listen_angry_01.max.fbx` | 1,667 → 4,067 s |
| `rb-angry-2.vrma` | `f_gestic_talk_angry_01.max.fbx` | 0 → 3,533 s |
| `rb-sad.vrma` | `f_gestic_listen_sad_01.max.fbx` | 13,5 → 19,5 s |

Les 38 sources sont **38 fichiers FBX distincts** de la section `static` du
dépôt — celle des animations jouées sur place, la seule qui ait un sens en face
à face. Tous viennent du **même personnage féminin** : c'est la condition de
l'étanchéité de la famille.

---
