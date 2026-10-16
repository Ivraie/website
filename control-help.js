// Tooltips for the settings panel: a one-line description per control,
// shown when hovering its row (label and control) and read by screen readers.
(function () {
    const HELP = {
        // Structure
        creatureShape: 'What new creatures are built from: a grid of points, or the outline of a character.',
        letterInput: 'The character used as the body shape of new creatures (Letter shape).',
        pointDensity: 'How many points make up a creature: more points give finer, heavier bodies.',
        numFeet: 'How many feet each new creature has.',
        restLength: 'Natural length of the springs: below 1 the body pulls itself together, above 1 it swells.',
        randomPlacement: 'Place the feet on random points of the body instead of evenly around its outline.',
        keepOnScreenCheck: 'Screen edges act as walls and a floor: bodies stop and slide there, and feet can stand on the floor. Off: no floor, creatures hang from the top and sides.',
        pruneUnfooted: 'Remove parts of the body that are not connected to any foot.',
        minPointsPerFoot: 'With Remove Loose Parts on, smallest number of points a part needs to be kept.',
        // Population
        enableCreatureLimit: 'Limit how many creatures can be on screen at once.',
        maxCreatures: 'Most creatures allowed on screen at once.',
        enablePointLimit: 'Limit the total number of points on screen (keeps the animation fast).',
        maxPoints: 'Most points allowed on screen in total; new creatures wait until there is room.',
        autoMode: 'How new creatures appear: never on their own, when the screen is empty, or continuously.',
        autoAddDelay: 'Seconds between two automatic new creatures.',
        randomizeModeSelect: 'What Randomize does: new settings and a fresh start, or new settings for the next creatures only.',
        burstSize: 'How many creatures a burst gives birth to (B key: at random places; long press on the paper: around your finger).',
        burstSpread: 'Seconds over which the burst births are spread: 0 is all at once.',
        burstForce: 'How hard burst creatures are pushed outward at birth.',
        burstKeyOrigin: 'Where a burst from the B key is born: at random places, or around the center of the screen.',
        randomizeBtn: 'Pick random settings.',
        addCreatureBtn: 'Add one creature now (Space does the same).',
        // Appearance
        creatureColor: 'Color of the creatures at rest.',
        shiverColor: 'Color the creatures move toward while a shiver runs through them.',
        darkPaperCheck: 'Invert the page: black paper and white ink, for dark rooms and projection. Also with ?dark in the address.',
        rendererMode: 'How the creatures are drawn: WebGL is much faster with many points and looks the same; Canvas is the original drawing. G switches between them. Letter mode always uses Canvas.',
        drawMode: 'Draw each point as a dot, or as a letter.',
        pointSize: 'Base size of the dots.',
        pointSizeVariation: 'How much dot sizes vary from point to point.',
        maxLineThickness: 'Thickest a spring line can get while shivering.',
        minShade: 'Darkness of the lines and dots at rest (0 is the lightest).',
        shiverEffect: 'How strongly a shiver darkens and swells the lines and dots.',
        letterChoice: 'The letter drawn at every point (Letter draw mode).',
        // Printing
        printInterval: 'While the title is held (or after a double tap), time between two prints of the creatures.',
        printIntervalRandomness: 'Random variation of that interval: at 100% between half and double, at 300% between a quarter and four times.',
        imprintColor: 'Ink color of the prints, when they do not follow the creature colors.',
        imprintMatchesCreatureCheck: 'Print in the creature and shiver colors instead of the Imprint Color.',
        imprintShade: 'Strength of each print: low values give faint, layered imprints.',
        imprintShadeVariation: 'Random strength for each print around the Print Strength: at 50%, from half to one and a half times.',
        imprintBlendMode: 'How a new print mixes with the imprints already on the page.',
        printOnShiverCheck: 'Print a creature each time one of its feet lands and starts a shiver.',
        fadeImprintsCheck: 'Imprints slowly disappear instead of staying on the page.',
        fadeTime: 'How many seconds an imprint takes to fade away.',
        fadeAmount: 'How much of each imprint fades: 100% disappears completely, 50% fades to half and stays.',
        blendFadeLayersCheck: 'Fading imprints mix with older ones using the Imprint Blend Mode. Looks closer to one sheet, but costs speed.',
        perCreatureImprintCheck: 'Each creature prints with the imprint settings in place when it was born.',
        // Tendrils
        enableTendrils: 'Grow hair-like tendrils from the edge of new creatures.',
        numTendrils: 'How many tendrils each creature grows.',
        tendrilLength: 'Length of the tendrils, in segments.',
        tendrilQuality: 'Multiplies the tendril length: lower values give shorter tendrils with fewer points.',
        tendrilLengthVariation: 'How much tendril lengths vary within a creature.',
        tendrilStiffness: 'How stiff the tendrils are: soft tendrils droop and can let a creature sag.',
        shiversOnTendrils: 'Let shivers travel along the tendrils too.',
        feetOnTendrils: 'Put the feet at the tip of the tendrils, so the creature hangs from them.',
        // Motion physics
        stiffness: 'How firmly the body springs hold their shape.',
        damping: 'How quickly movement settles: higher values make motion calmer.',
        shiverIntensity: 'How much a shiver shortens the springs (negative values stretch them instead).',
        shiverPropagation: 'How much of a shiver passes from one point to the next.',
        shiverPropagationSpeed: 'How fast a shiver travels through the body.',
        shiverDuration: 'How long a shiver lingers before it fades.',
        // Gravity & sensors
        gravitySource: 'Fixed downward gravity, or gravity that follows the tilt of a phone or tablet.',
        gravity: 'Strength of gravity (in tilt mode: how strongly tilting pulls the creatures).',
        // Birth & death
        enableProgressiveAppearance: 'New creatures grow from their feet outward instead of appearing all at once.',
        growthSpeed: 'Frames between each ring of points appearing as a creature grows.',
        enableAging: 'Creatures die after a while (and print themselves when they die).',
        agingMode: 'Whether creatures die after a time or after a number of footsteps.',
        lifespan: 'How long a creature lives, in seconds (each one varies by up to 20%).',
        maxSteps: 'How many footsteps a creature takes before it dies.',
        deathEffect: 'What a creature does when it dies.',
        // Breathing
        enableBreathing: 'The body slowly swells and shrinks, like breathing.',
        breathingRate: 'Speed of the breathing.',
        breathingAmplitude: 'How much the body swells and shrinks.',
        breathingOffset: 'Average size of the body while breathing.',
        // Foot behavior
        gaitPattern: 'Which feet move together: one after another, in pairs, or in a wave.',
        numSeekingFeet: 'How many feet can be lifted and walking at the same time.',
        waveDelay: 'Seconds between feet in a wave gait.',
        footCoordination: 'How much a lifted foot heads opposite the body instead of to a random edge.',
        stepCooldown: 'Seconds a foot rests after landing before it can move again.',
        targetAttraction: 'How strongly a lifted foot is pulled toward the edge it is heading for.',
        stepDuration: 'Seconds before a foot that has not reached its edge picks a new target.',
        stepHeight: 'How high a foot lifts while stepping.',
        wobbleStrength: 'How much a lifted foot wanders on its way.',
        // Export
        copyParamsBtn: 'Copy all current settings to the clipboard as text.',
    };

    for (const [id, text] of Object.entries(HELP)) {
        const control = document.getElementById(id);
        if (!control) continue;
        // The row: the control's own wrapper (label + control), not the whole group.
        const row = control.closest('.sub-control, .color-control') || control.parentElement;
        const target = row && !row.classList.contains('control-group') ? row : control;
        target.title = text;
        control.setAttribute('aria-description', text);
    }
})();
