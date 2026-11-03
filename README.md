# 🐑 Taistelulampaat – moninpeli verkossa

Suomenkielinen verkkoselainversio taktisesta lautapelistä **Battle Sheep (Taistelulampaat)**. Voit pelata verkossa 1–4 pelaajan kesken, tekoälyä vastaan tai samalla laitteella (hot-seat).

**Pelaa suoraan verkossa:** https://sammakkoshamaani.github.io/Taistelulampaat/

## Ominaisuudet

- **Verkkomoninpeli 1–4 pelaajalle:** Toimii vertaisverkkoyhteydellä (WebRTC / PeerJS) ilman erillistä taustapalvelinta. Huoneen luojan selain toimii isäntänä, ja ystävät liittyvät mukaan 5-merkkisellä huonekoodilla tai suoralla kutsulinkillä.
- **Tekoälybotit (3 vaikeustasoa):** Helppo, keskitaso ja vaikea. Jokaiselle paikalle voidaan asettaa botti, joten yksinpelaaja voi pelata 1–3 bottia vastaan.
- **Pelaaminen samalla laitteella:** Useampi pelaaja voi pelata vuorotellen samalta ruudulta.
- **Rauhallinen taustamusiikki:** Web Audio API:lla syntetisoitu laidunmusiikki, jonka voi kytkeä päälle tai pois yläpalkin painikkeesta.
- **Dynaamisesti generoituva laidun:** Jokainen peli luo uudenlaisen laitumenneljän heksan laattapaloista (kompakti, normaali tai levittäytyvä).
- **Yhteyden palautus:** Jos pelaaja päivittää selainsivun, hän pääsee automaattisesti takaisin omalle paikalleen. Yhteyden katketessa isäntä voi korvata pudonneen pelaajan botilla.
- **Mobiili- ja tietokoneyhteensopiva:** Toimii kaikilla laitteilla ilman asennusta tai käännösvaihetta (puhdasta HTML-, CSS- ja JavaScript-koodia).

## Pelisäännöt

1. Kukin pelaaja asettaa vuorollaan koko 16 lampaan laumansa tyhjälle kentälle laitumen **ulkoreunalle**.
2. Vuorollasi valitse jokin olemassa olevista pinoistasi, jossa on vähintään 2 lammasta, ja **jaa se**: jätä vähintään 1 lammas paikalleen ja siirrä loput eteenpäin.
3. Liikkuvat lampaat kulkevat **suorassa linjassa** (6 eri suuntaan) ja etenevät **niin pitkälle kuin mahdollista**, kunnes vastaan tulee laidunalueen reuna tai toinen lammaspino.
4. Jos pelaaja ei voi tehdä yhtäkään laillista siirtoa, vuoro ohitetaan. Peli päättyy, kun yksikään pelaaja ei voi enää liikkua.
5. **Voittaja:** Pelaaja, jolla on pelin päättyessä hallussaan eniten laidunruutuja. Tasatilanteen ratkaisee suurin yhtenäinen laidunalue.

## Paikallinen suoritus ja testit

```bash
python3 -m http.server 8080   # Avaa sitten selaimessa: http://localhost:8080
npm test                      # Ajaa bottien väliset simulaatiot ja huonetestit
```

## Arkkitehtuuri

| Tiedosto | Rooli |
| --- | --- |
| `js/game.js` | Pelilogiikka, laidungeneraattori, siirtojen validointi ja pistelasku |
| `js/bot.js` | Tekoäly: aluepohjainen heuristiikka ja siirtojen ennakointi |
| `js/room.js` | Isäntäselaimessa pyörivä huonehallinta (pelaajapaikat, vuorot, botit) |
| `js/net.js` | P2P-verkkoliikenne (PeerJS WebRTC + BroadcastChannel välilehtien välille) |
| `js/audio.js` | Syntetisoitu pastoralinen taustamusiikki (Web Audio API) |
| `js/main.js` | Käyttöliittymä, SVG-laudan piirto, animaatiot ja tapahtumat |

> Battle Sheep on Blue Orange Gamesin tavaramerkki. Tämä on vapaa fanitoteutus opetus- ja harrastekäyttöön.
