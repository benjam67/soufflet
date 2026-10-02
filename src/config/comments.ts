// Phrases du commentateur, par situation. Ton absurde et exagéré.
export const COMMENTS = {
  roundStart: ['Mesdames, messieurs, ça va claquer !', 'Le patron siffle, les joues tremblent !', 'Qui repartira avec la joue en feu ?'],
  crit: ['Il lui a refait le portrait !', 'CLAQUE DU SIÈCLE ! On l’entend jusqu’à la mairie !', 'Une gifle parfaite, à encadrer au-dessus du comptoir !', 'Ça, c’est de la gifle d’artisan !'],
  big: ['Quelle mandale ! Les verres en tremblent !', 'Ça résonne jusqu’au fond de la cave !', 'Ouille ouille ouille, la joue est cuite !'],
  normal: ['Propre, net, sans bavure.', 'Une bonne gifle de comptoir.', 'Ça claque, mais ça tient debout !', 'Joli revers, tout dans le poignet !'],
  grazed: ['Ça a juste effleuré la moustache…', 'Un peu de travers, ça !', 'Un courant d’air, tout au plus.'],
  missed: ['Raté ! Il a giflé l’air du bar !', 'Le ventilateur a pris plus cher que la joue !', 'Visez la joue, pas le plafond !'],
  limp: ['Une gifle molle… le public siffle !', 'C’est une caresse, ça ?', 'Trop lent ! Gifle de dimanche matin.'],
  self: ['Il s’est giflé tout seul ! Magnifique !', 'Surchauffe ! Il se met une claque à lui-même !', 'L’autogifle, une spécialité locale.'],
  rage: ['La rage monte ! Ça va faire très mal…', 'Il voit rouge ! Planquez les verres !', 'Les veines du cou sont sorties !'],
  battoir: ['LE BATTOIR ! Une main comme une pelle à tarte !', 'Le Battoir ! On a senti le courant d’air jusqu’au comptoir !'],
  toupie: ['LA TOUPIE ! Elle tourne, elle tourne… et ça claque !', 'Trois claques en une ! La Toupie est lâchée !'],
  dodge: ['Esquivé ! La joue a filé comme une savonnette !', 'Il a vu venir la claque !', 'Un pas en arrière, et la gifle perd son jus !'],
  perfect: ['ESQUIVE PARFAITE ! Il n’a senti qu’un courant d’air !', 'Quel réflexe ! Un chat de gouttière !'],
  guard: ['GARDE DE RAGE ! Toute la colère dans un seul réflexe !', 'Il a tout misé sur l’esquive !'],
  lastWord: ['Il est cuit… mais il a le droit de répondre !', 'Une dernière gifle avant de tomber !', 'Le droit de réponse ! Tout peut basculer !'],
  doubleKo: ['DOUBLE K.O. ! Les deux au tapis !', 'Ils tombent ensemble ! On regarde qui a le moins morflé…'],
  stun: ['Sonné ! Il voit des petits oiseaux !', 'Les jambes en coton ! La jauge va faire n’importe quoi !'],
  ko: ['K.O. ! Appelez le pharmacien du village !', 'Rideau ! Il voit des étoiles !', 'Il est sonné comme une cloche de l’église !'],
} as const;

export type CommentKind = keyof typeof COMMENTS;
