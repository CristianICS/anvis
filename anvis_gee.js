// Visor con las herramientas básicas para interpretar
// cubiertas mediante imgs. de TDT: Sentinel 2

// Add puntos con verdad terreno
var LUCAS = ee.FeatureCollection('JRC/LUCAS_HARMO/THLOC/V1')
  .filter(ee.Filter.eq('year', 2018))
  .select([
    'lu1_label',
    'lc1_label',
    'lc1_perc',
    'file_path_gisco_east', 
    'file_path_gisco_north', 
    'file_path_gisco_point',
    'file_path_gisco_south', 
    'file_path_gisco_west'
  ]);

/**
 * Aplicar máscara de nubes
 * ========================
 * Utiliza la banda QA de Sentinel-2
 * @param {ee.Image} image
 * @return {ee.Image} imgn Sentinel-2 sin nubes
 */
function maskS2clouds(image) {
  // Band with quality info.
  var qa = image.select('QA60');

  // Bits 10 and 11 are clouds and cirrus, respectively.
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image
    .updateMask(mask)
    // Mantener info. de la imgn. que se utiliza en el script
    .copyProperties(image, ['system:index', 'CLOUDY_PIXEL_PERCENTAGE']);
}

// Convertir valores enteros en los valores originales de reflectividad
// Aplicar el "scale factor"
function scaleFactor(image) {
  return image
    .divide(10000)
    // Mantener info. de la imgn. que se utiliza en el script
    .copyProperties(image, ['system:index', 'CLOUDY_PIXEL_PERCENTAGE']);
}

// Iniciar el objeto donde se incluyen las funciones de la app.
var app = {}; 

// Crear paneles principales en el menú izquierdo
app.createPanels = function() {
  // Descripción de la APP
  app.intro = {
    panel: ui.Panel([
      ui.Label({
        value: 'Análisis Visual',
        style: {fontWeight: 'bold', fontSize: '24px', margin: '10px 5px'}
      }),
      ui.Label('Aplicación que permite filtrar imágenes de la colección S2_SR ' +
               'y crear gráficos con los valores de sus bandas. Sirve de guía para ' +
               'el análisis visual de las cubiertas.'),
      ui.Label({
        value: 'Cada vez que se pulsa sobre "Aplicar filtros" se seleccionan' +
               ' las imágenes por las coordenadas del centro del mapa.'
        })
      ])
  };

  // Filtros de la colección
  app.filters = {
    cloudMask: ui.Checkbox({label: 'Aplicar mascara de nubes', value: false}),
    startDate: ui.Textbox('YYYY-MM-DD', '2020-05-01'),
    endDate: ui.Textbox('YYYY-MM-DD', '2020-09-01'),
    cloudFilter: ui.Slider({min: 0, max: 1, step: 0.1, value: 0.5, style: {stretch: 'horizontal'}}),
    applyButton: ui.Button('Aplicar filtros', app.applyFilters),
    loadingLabel: ui.Label({
      value: 'Cargando...',
      style: {stretch: 'vertical', color: 'gray', shown: false}
    })
  };

  // Texto del panel con los filtros
  app.filters.panel = ui.Panel({
    widgets: [
      ui.Label('1) Filtros', {fontWeight: 'bold'}),
      ui.Label('Las imágenes se filtran por la coordenada central del mapa.'),
      ui.Label('Fecha inicial (desde 01/04/2017)', app.HELPER_TEXT_STYLE), app.filters.startDate,
      ui.Label('Fecha final', app.HELPER_TEXT_STYLE), app.filters.endDate,
      ui.Label('Filtro de nubes', app.HELPER_TEXT_STYLE), app.filters.cloudFilter,
      app.filters.cloudMask,
      ui.Panel([
        app.filters.applyButton,
        app.filters.loadingLabel
      ], ui.Panel.Layout.flow('horizontal'))
    ],
    style: app.SECTION_STYLE
  });

  // Seleccón de las imágenes
  app.picker = {
    select: ui.Select({
      placeholder: 'Selecciona un ID',
      // Cuando una imgn. se selecciona, actualiza el mapa para incluirla
      onChange: app.refreshMapLayer
    }),
    // Botón para centrar el mapa en la imagen
    // IMPORTANTE: Debe ser cargada la primera
    centerButton: ui.Button('Centrar', function() {
      // Seleccionar la imagen del panel de capas
      var image = Map.layers().get(0);
      Map.centerObject(image.get('eeObject'));
    }),
    // Add un filtro de paso alto
    highPass: ui.Checkbox({
      label: 'Aplicar filtro de paso alto', 
      value: false, 
      onChange: app.refreshMapLayer})
  };

  // Panel con las etiquetas de selección de imgns.
  app.picker.panel = ui.Panel({
    widgets: [
      ui.Label('2) Selecciona una imagen', {fontWeight: 'bold'}),
      ui.Panel([
        app.picker.select,
        app.picker.highPass,
        app.picker.centerButton],
      ui.Panel.Layout.flow('vertical'))
    ],
    style: app.SECTION_STYLE
  });

  // Panel con opciones de visualización
  app.vis = {
    label: ui.Label(),
    // Mostrar composiciones de color prestablecidas
    select: ui.Select({
      items: Object.keys(app.VIS_OPTIONS),
      onChange: function() {
        // Cada vez que se cambia el param, actualiza su nombre
        var option = app.VIS_OPTIONS[app.vis.select.getValue()];
        app.vis.label.setValue(option.description);
        // Volver a cargar la imagen con la nueva visualización
        app.refreshMapLayer();
      }
    }),
    // Botón para mostrar los valores de NDVI en lugar de la firma
    ndvi: ui.Checkbox({label: 'Ver NDVI', value: false}),
    // Filtro de gamma (ajuste de brillo)
    gammaFilter: ui.Slider({
      min: 0, max: 5, step: 0.1, value: 1.1, 
      style: {stretch: 'horizontal'}, onChange: app.refreshMapLayer})
  };

  // Escribir el texto del panel de visualización
  app.vis.panel = ui.Panel({
    widgets: [
      ui.Label('3) Visualización', {fontWeight: 'bold'}),
      app.vis.select,
      app.vis.label,
      app.vis.ndvi,
      ui.Label('Filtro de gamma (ajustar brillo)', app.HELPER_TEXT_STYLE), app.vis.gammaFilter
    ],
    style: app.SECTION_STYLE
  });

  // Seleccionar la primera composición de color
  app.vis.select.setValue(app.vis.select.items().get(0));
  
  // Panel en el que se puede filtrar la BBDD LUCAS
  app.lucas = {
    select: ui.Select({
      placeholder: 'Selecciona una categoría',
      onChange: app.refreshMapLayer
    }),
  };
  
  // Componer el panel con el filtro para la capa LUCAS
  app.lucas.panel = ui.Panel({
    widgets: [
      ui.Label('4) Filtro LUCAS', {fontWeight: 'bold'}),
      app.lucas.select,
    ],
    // Add un margen inferior elevado para que el desplegable con las
    // clases a filtrar sea mayor
    style: {margin: '20px 0 80px 0'}
  });
  
};

// Crear las funciones principales
app.createHelpers = function() {
  /**
   * Detectar si la API esta aplicando los filtros a las imgs.
   * En este caso, evitar que se utilicen las funciones que
   * interactuan con las imgs. para que no haya errores.
   * TODO: Mejorar todo el sistema de "LoadingMode"
   * @param {boolean} enabled Whether loading mode is enabled.
   */
  app.setLoadingMode = function(enabled) {
    // Set the loading label visibility to the enabled mode.
    app.filters.loadingLabel.style().set('shown', enabled);
    // Set each of the widgets to the given enabled mode.
    var loadDependentWidgets = [
      app.vis.select,
      app.vis.ndvi,
      app.filters.startDate,
      app.filters.endDate,
      app.filters.applyButton,
      app.filters.cloudFilter,
      app.filters.cloudMask,
      app.picker.select,
      app.picker.centerButton,
      app.picker.highPass,
      app.lucas.select
    ];
    loadDependentWidgets.forEach(function(widget) {
      widget.setDisabled(enabled);
    });
  };
  
  // Aplicar los filtros
  app.applyFilters = function() {
    // Activar las dependencias
    app.setLoadingMode(true);
    
    // Seleccionar la lista de etiquetas LUCAS
    var computedLucasCls = LUCAS
        .reduceColumns(ee.Reducer.toList(), ['lc1_label'])
        .get('list');
    // Add una opción para mantener todas las etiquetas LUCAS
    computedLucasCls = ee.List(computedLucasCls).insert(0, "Ninguno");
    // Seleccionar el conjunto de etiquetas (sin repeticiones)
    ee.List(computedLucasCls).distinct().evaluate(
      // Incluirlas en la selección del filtro LUCAS
      function(cls) {
        // Update lucas picker with the given list of cls.
        app.lucas.select.items().reset(cls);
        // Default the lucas picker to the first cls.
        app.lucas.select.setValue(app.lucas.select.items().get(0));
    });

    // Seleccionar la imgn. a mostrar en el visor
    var collection = ee.ImageCollection(app.COLLECTION_ID)
      // Filtrar por las coordenadas del centro del mapa
      .filterBounds(Map.getCenter());

    // Aplicar los filtros del panel picker
    // Filtro de nubes
    if (app.filters.cloudFilter.getValue()) {
      // Obtener porcentajes
      var cloud_percent = app.filters.cloudFilter.getValue() * 100;
      collection = collection.filter(
        ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_percent));
    }

    // Filtro de fecha
    var start = app.filters.startDate.getValue();
    if (start) start = ee.Date(start);
    var end = app.filters.endDate.getValue();
    if (end) end = ee.Date(end);
    if (start) collection = collection.filterDate(start, end);

    // Obtener una lista con los ids del conjunto de imgs. filtradas
    var computedIds = filtered
        .limit(app.IMAGE_COUNT_LIMIT)
        .reduceColumns(ee.Reducer.toList(), ['system:index'])
        .get('list');

    // Obtener la fecha de captura (desde el ID)
    var computedDates = ee.List(computedIds)
      .map(function(id){
        // Seleccionar la primera parte del ID, que contiene la fecha
        var date = ee.String(id).split('_').get(0);
        // Actualizar el formato para poder convertirla a ee.Date
        var good_date = ee.String(date).replace("T"," ");
        var eedate = ee.Date.parse('YYYYMMdd HHmmss', good_date);
        return eedate.format('YYYY/MM/dd HH:mm:ss');
      });

    // Incluir la fecha de las imgs. en el panel de selección
    computedDates.evaluate(function(dates) {
      // Habilitar las funciones de la APP
      app.setLoadingMode(false);
      // Incluir las fechas en el selector de imgs.
      app.picker.select.items().reset(dates);
      // Poner por defecto la fecha de la primera imgn. filtrada
      app.picker.select.setValue(app.picker.select.items().get(0));
    });
    
  };
  
  /** Actualizar el mapa para aplicar los cambios los paneles de filtros */
  app.refreshMapLayer = function() {
    // Resetear el mapa principal (eliminar las capas)
    Map.clear();

    // Seleccionar la fecha de la imagen a obtener
    var imageDate = app.picker.select.getValue();
    
    if (imageDate) {

      // Transformar la fecha en ee.Date
      var parsedImgDate = ee.Date.parse('YYYY/MM/dd HH:mm:ss', imageDate)
      // Seleccionar la imagen con la misma fecha:
      // IMPORTANTE: En la col. de Sentinel 2 existen varias imgs. para la misma fecha
      // (en función de su "TILE". Por ello, para seleccionar la imagen correcta,
      // además de la fecha de la imagen se utiliza la posición del mapa.
      var strDate = parsedImgDate.format('YYYYMMdd');
      var strTime = parsedImgDate.format('HHmmss');
      // Modificar la fecha para que coincida con la primera parte del ID de la imagen
      // (de donde se ha obtenido en un principio)
      var idStarts = ee.String(strDate).cat('T').cat(strTime)
      
      // Seleccionar la imagen
      var image = ee.ImageCollection(app.COLLECTION_ID)
          .filterBounds(Map.getCenter())
          // Se obtiene el mismo resultado filtrando por ID que por fecha
          .filter(ee.Filter.stringStartsWith('system:index', idStarts))
          .first();
          
      // Apply cloud mask
      if (app.filters.cloudMask.getValue()) {
        image = ee.Image(maskS2clouds(image));
      }
      
      // Obtener valores de reflectividad
      image = ee.Image(scaleFactor(image));
      
      // Cargar la imagen con las opciones de visualización seleccionadas
      var visOption = app.VIS_OPTIONS[app.vis.select.getValue()];
      // Aplicar el filtro de gamma
      if (app.vis.gammaFilter.getValue()){
        var gamma_value = app.vis.gammaFilter.getValue();
        visOption.visParams.gamma = gamma_value;
      }

      // Utilizar el filtro de paso alto
      if (app.picker.highPass.getValue()){
        // Define a Laplacian, or edge-detection kernel.
        var laplacian = ee.Kernel.laplacian8({ normalize: false });
        visOption.visParams.max = 0.5
        // Apply the edge-detection kernel.
        image = image.convolve(laplacian);
      }
      
      Map.addLayer(image, visOption.visParams, imageDate);
    }

    // Cargar los puntos LUCAS con el valor de Land Cover seleccionado
    var lucasId = app.lucas.select.getValue();
    
    if (lucasId != "Ninguno") {
      Map.addLayer(LUCAS.filter(ee.Filter.eq('LC_LABEL', lucasId)), {}, 'BBDD LUCAS (2018)');
    } else {
      Map.addLayer(LUCAS, {}, 'BBDD LUCAS (2018)');
    }
    // Add CORINE Land Cover
    var CORINE = ee.Image(app.CORINE_ID).select('landcover');
    Map.addLayer(CORINE, {}, 'CORINE Land Cover');
    
    // Cambiar la apariencia del cursor sobre el mapa
    Map.style().set('cursor', 'crosshair');
    
    // Crear un panel (abajo a la derecha) para mostrar
    // la firma espectral y el NDVI
    var inspector = ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {position: 'bottom-right'}
    });
    
    // Add una etiqueta descriptiva del panel
    inspector.add(ui.Label('Marca un punto para ver la firma espectral/NDVI'));
    
    // Add the panel to the default map.
    Map.add(inspector);
    
    // La siguiente func. se ejecuta cada vez que el usuario hace un click
    // sobre la vista de mapa. El evento debe devolver las coordenadas del punto
    function handleMapClick(location){

      // Crear un objeto ee con las coordenadas del punto
      var p = ee.Geometry.Point([location.lon,location.lat]);
      // TODO: Incluir una popup con la info. de LUCAS si existe un punto
      // sobre la posición seleccionada.
      // TODO: Crear un punto para mostrar la localización del click
      
      // Limpiar el panel de elementos antiguos
      inspector.clear();

      // Mostrar el NDVI
      if (app.vis.ndvi.getValue()){
        
        // Seleccinar imgs. sobre el punto
        var col = ee.ImageCollection(app.COLLECTION_ID).filterBounds(p); 
        // Func. para calcular el NDVI
        var getNDVI = function(img){
          var ndvi = img.normalizedDifference(['B8','B4']).rename("NDVI");
          // IMPORTANTE: Mantener la propiedad "time_start" para poder generar el chart
          return ndvi.copyProperties(img, ['system:time_start']);
        };

        // En un primer momento, se derivaba una imgn. por mes
        // https://gis.stackexchange.com/a/465619/240994
        // Problema: En una serie larga de imgns. se quedaba sin tiempo de computación
        var ndvi = col.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',10))
          .map(maskS2clouds)
          .map(getNDVI)
          .map(function(img){
            var date = ee.Date(ee.Number(img.get("system:time_start")));
            var m = ee.Number(date.get('month'));
            var y = ee.Number(date.get('year'));
            return img.set({'month': m, 'year': y})
          });

        var months = ee.List.sequence(1, 12)
        var years = ee.List.sequence(2018, 2020)

        /*
        var ndvi_byYearMonth = ee.ImageCollection.fromImages(
          years.map(function(y){
            return months.map(function(m){
              var imgs = ndvi.filterMetadata('year', 'equals', y)
                              .filterMetadata('month', 'equals', m)
              // Construct new system:time_start
              var time_start = ee.Date.fromYMD(y, m, 1).millis();
              // return imgs.select('NDVI').mean()
                    // .set('system:time_start', time_start)
              return imgs.select('NDVI').set('system:time_start', time_start)
            })
          }).flatten()
        )
        
        var ndviChart = ui.Chart.image.doySeriesByYear({
          imageCollection: ndvi, 
          bandName: 'NDVI',  
          region: p,
          regionReducer: ee.Reducer.mean(), 
          scale: 70,
          sameDayReducer: ee.Reducer.mean()
        });
        */
        var ndviChart = ui.Chart.image.series({
          imageCollection: ndvi.select('NDVI'), 
          region: p,
          reducer: ee.Reducer.mean(), 
          scale: 100 // Agilizar el cálculo
        });
        // ndviChart.setChartType('LineChart');
        ndviChart.setOptions({
          title: 'Serie de NDVI',
          // vAxis: {title: 'NDVI'}
        });

        inspector.widgets().set(2,ndviChart);
        
      } else {
        // Crear chart con la firma espectral del punto
        var wavelengths = ['494','560','665','704','740','780','835','864','945','1612','2200']
        
        var wChart = ui.Chart.image.regions({
          image: image.select(['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B9', 'B11', 'B12'], wavelengths),
          regions: p,
          reducer: ee.Reducer.mean(),
          scale: 10,
          xLabels: [494,560,665,704,740,780,835,864,945,1612,2200]
        });
        wChart.setOptions({
          title: 'Signatura espectral',
          vAxis: {
            title: 'Reflectividad'
            // Modificar el eje Y para establecer siempre los mismos valores min/max
            // viewWindow: {min: 0, max: 1}
          },
          hAxis: {title: 'nm'}
        });
        
        inspector.widgets().set(2,wChart);
      }
      
      // Add a button to close the Panel
      inspector.add(ui.Button({
        label: 'Close',
        onClick: function() {
          // inspector.style().set('shown', false);
          inspector.clear();
          inspector.add(ui.Label('Marca un punto para ver la firma espectral/NDVI'));
        }
      }));
    }
    
    Map.onClick(handleMapClick);

  };
  
};

// Crear las constantes de la APP (variables globales)
app.createConstants = function() {
  app.COLLECTION_ID = 'COPERNICUS/S2_SR_HARMONIZED';
  app.CORINE_ID = 'COPERNICUS/CORINE/V20/100m/2018';
  app.IMAGES = ee.Dictionary();
  app.SECTION_STYLE = {margin: '20px 0 0 0'};
  app.HELPER_TEXT_STYLE = {
      margin: '8px 0 -3px 8px',
      fontSize: '12px',
      color: 'gray'
  };
  app.IMAGE_COUNT_LIMIT = 50;
  app.VIS_OPTIONS = {
    'Color natural (B4/B3/B2)': {
      description: 'Los elementos de la imagen adquieren colores similares ' +
                     'a los vistos por la visión de las personas.',
      visParams: {min: 0, max: 0.3, bands: ['B4', 'B3', 'B2']}
    },
    'Pseudo color natural (B12/B8/B4)': {
      description: 'La vegetación vigorosa se muestra en tonos verdes intensos, ' +
      'las áreas con vegetación arbustiva tonos marrones y las áreas con escasa ' +
      'vegetación en tonos blancos.',
      visParams: {min: 0, max: 0.3, bands: ['B12', 'B8', 'B4']}
    },
    'Infrarrojo color (B8/B4/B3)': {
      description: 'La vegetación se muestra en tonos naranjas, ' +
                   'las áreas urbanas en azul azul metálico, los suelos sin vegetación blancos.',
      visParams: {min: 0, max: 0.3, bands: ['B8', 'B4', 'B3']}
    },
    'Infrarrojo color mejorado (B8/B11/B4)': {
      description: 'Recommended standard colour rendition for photointerpretation of S2 images',
      visParams: {min: 0, max: 0.3, bands: ['B8', 'B11', 'B4']}
    },
    'Falso color (B8/B4/B3)': {
      description: 'Las cubiertas vegetales se mostrarán en color rojo, ' +
      'pues presentan una elevada respuesta espectral en el IRC a causa ' +
      'de su actividad fotosintética. Permite una fácil identificación ' +
      'de las masas de agua y las cubiertas de uso urbano.',
      visParams: {min: 0, max: 0.3, bands: ['B8', 'B4', 'B3']}
    },
    'Falso color 2 (B12/B11/B4)': {
      description: '',
      visParams: {min: 0, max: 0.3, bands: ['B12', 'B11', 'B4']}
    },
    'Burned areas (B12/B8/B2)': {
      description: 'Vegetación quemada en tonos rojizos.',
      visParams: {min: 0, max: 0.3, bands: ['B12', 'B8', 'B2']}
    }
  };
};

// Iniciar la APP
app.boot = function() {
  app.createConstants();
  app.createHelpers();
  app.createPanels();
  var main = ui.Panel({
    widgets: [
      app.intro.panel,
      app.filters.panel,
      app.picker.panel,
      app.vis.panel,
      app.lucas.panel
    ],
    style: {width: '320px', padding: '8px'}
  });
  Map.setCenter(-0.76, 41.11, 9);
  ui.root.insert(0, main);
  app.applyFilters();
};

app.boot();



