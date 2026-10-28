# Access Card (FR)

Carte Home Assistant pour les **accès** (portail, garage…) : caméra en direct, **déblocage avec cadenas animé** et compte à rebours de **re-verrouillage automatique**, boutons d'ouverture visibles uniquement une fois débloqué, avec **double appui de confirmation**. Style verre, thème clair/sombre automatique, éditeur visuel, textes en français.

## Installation (HACS)
1. HACS → ⋮ → *Dépôts personnalisés* → `https://github.com/Johan854/access-card`, catégorie **Tableau de bord**.
2. Installer, puis recharger le navigateur.

## Exemple
```yaml
type: custom:access-card
title: Accès
accesses:
  - name: Portail
    icon: mdi:gate
    camera_entity: camera.portail            # facultatif
    unlock_entity: input_boolean.deblocage_portail
    state_entity: binary_sensor.portail_ferme  # facultatif (ouvert / fermé)
    relock_minutes: 5                        # 0 = pas de re-verrouillage
    confirm: true                            # double appui pour ouvrir
    buttons:
      - { entity: switch.ouverture_pieton, name: Piéton, icon: mdi:walk }
      - { entity: switch.ouverture_voiture, name: Voiture, icon: mdi:car }
```
Sans `unlock_entity` (pas de cadenas), les boutons sont toujours affichés : pratique pour des volets.
Les entités `button` sont pressées, `script` lancés, les `cover` pilotées avec `action: open | close | stop`, les autres basculées (`toggle`).

```yaml
  - name: Volets des combles
    icon: mdi:window-shutter
    confirm: false                 # pas de double appui
    subtitle: Combles               # facultatif
    buttons:
      - { entity: button.esp_volet_combles_volet_ouvrir, name: Ouvrir, icon: mdi:window-shutter-open }
      - { entity: button.esp_volet_combles_volet_fermer, name: Fermer, icon: mdi:window-shutter }
```

## Re-verrouillage garanti
La carte re-verrouille d'elle-même tant que le tableau de bord est ouvert. Pour que cela fonctionne aussi tableau de bord fermé, ajoute cette automatisation :
```yaml
alias: Re-verrouillage accès
trigger:
  - platform: state
    entity_id: [input_boolean.deblocage_portail, input_boolean.deblocage_garage]
    to: "on"
    for: "00:05:00"
action:
  - service: input_boolean.turn_off
    target:
      entity_id: "{{ trigger.entity_id }}"
```
