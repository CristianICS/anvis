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

// S2 images have an scale factor: it transforms float number to integers
// This is a space reduction technique.
function scaleFactor(image) {
  return image.divide(10000).copyProperties(image, ['system:index', 'CLOUDY_PIXEL_PERCENTAGE']);
}

// The namespace for our application. All the state is kept in here.
var app = {};

// Create a label and slider.
var label = ui.Label('Light Intensity for Year');
// var slider = 

/** Creates the UI panels. */
app.createPanels = function() {
  /* The introduction section. */
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

  /* The collection filter controls. */
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

  /* The panel for the filter control widgets. */
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

  /* The image picker section. */
  app.picker = {
    // Create a select with a function that reacts to the "change" event.
    select: ui.Select({
      placeholder: 'Selecciona un ID',
      onChange: app.refreshMapLayer
    }),
    // Create a button that centers the map on a given object.
    centerButton: ui.Button('Centrar', function() {
      Map.centerObject(Map.layers().get(0).get('eeObject'));
    }),
    // Add a high pass filter (laplacian kernel)
    highPass: ui.Checkbox({label: 'Aplicar filtro de paso alto', value: false, onChange: app.refreshMapLayer})
  };

  /* The panel for the picker section with corresponding widgets. */
  app.picker.panel = ui.Panel({
    widgets: [
      ui.Label('2) Selecciona una imagen', {fontWeight: 'bold'}),
      ui.Panel([
        app.picker.select,
        app.picker.highPass,
        app.picker.centerButton
      ], ui.Panel.Layout.flow('vertical'))
    ],
    style: app.SECTION_STYLE
  });

  /* The visualization section. */
  app.vis = {
    label: ui.Label(),
    // Create a select with a function that reacts to the "change" event.
    select: ui.Select({
      items: Object.keys(app.VIS_OPTIONS),
      onChange: function() {
        // Update the label's value with the select's description.
        var option = app.VIS_OPTIONS[app.vis.select.getValue()];
        app.vis.label.setValue(option.description);
        // Refresh the map layer.
        app.refreshMapLayer();
      }
    }),
    // Show NDVI graphic
    // ndvi: ui.Checkbox({label: 'Ver NDVI', value: false, onChange: app.refreshMapLayer}),
    ndvi: ui.Checkbox({label: 'Ver NDVI', value: false}),
    gammaFilter: ui.Slider({
      min: 0, max: 5, step: 0.1, value: 1.1, 
      style: {stretch: 'horizontal'}, onChange: app.refreshMapLayer})
  };

  /* The panel for the visualization section with corresponding widgets. */
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
  
  app.lucas = {
    // Create a select with a function that reacts to the "change" event.
    select: ui.Select({
      placeholder: 'Selecciona una categoría',
      onChange: app.refreshMapLayer
    }),
  };
  
  /* The panel for the LUCAS BBDD filter. */
  app.lucas.panel = ui.Panel({
    widgets: [
      ui.Label('4) Filtro LUCAS', {fontWeight: 'bold'}),
      app.lucas.select,
    ],
    style: {margin: '20px 0 80px 0'}
  });

  // Default the select to the first value.
  app.vis.select.setValue(app.vis.select.items().get(0));

  /* The export section. */
  app.export = {
    button: ui.Button({
      label: 'Export the current image to Drive',
      // React to the button's click event.
      onClick: function() {
        // Select the full image id.
        var imageIdTrailer = app.picker.select.getValue();
        var imageId = app.COLLECTION_ID + '/' + imageIdTrailer;
        // Get the visualization options.
        var visOption = app.VIS_OPTIONS[app.vis.select.getValue()];
        // Export the image to Drive.
        Export.image.toDrive({
          image: ee.Image(imageId).select(visOption.visParams.bands),
          description: 'L8_Export-' + imageIdTrailer,
        });
      }
    })
  };

  /* The panel for the export section with corresponding widgets. */
  app.export.panel = ui.Panel({
    widgets: [
      ui.Label('4) Start an export', {fontWeight: 'bold'}),
      app.export.button
    ],
    style: app.SECTION_STYLE
  });
};

/** Creates the app helper functions. */
app.createHelpers = function() {
  /**
   * Enables or disables loading mode.
   * @param {boolean} enabled Whether loading mode is enabled.
   */
  app.setLoadingMode = function(enabled) {
    // Set the loading label visibility to the enabled mode.
    app.filters.loadingLabel.style().set('shown', enabled);
    // Set each of the widgets to the given enabled mode.
    var loadDependentWidgets = [
      app.vis.select,
      app.vis.ndvi,
      // app.vis.gammaFilter,
      app.filters.startDate,
      app.filters.endDate,
      app.filters.applyButton,
      app.filters.cloudFilter,
      app.filters.cloudMask,
      app.picker.select,
      app.picker.centerButton,
      app.picker.highPass,
      app.export.button
    ];
    loadDependentWidgets.forEach(function(widget) {
      widget.setDisabled(enabled);
    });
  };
  
  /** Applies the selection filters currently selected in the UI. */
  app.applyFilters = function() {
    
    app.setLoadingMode(true);
    
    // Get the list of Lucas classes.
    var computedLucasCls = LUCAS
        .reduceColumns(ee.Reducer.toList(), ['LC_LABEL'])
        .get('list');

    ee.List(computedLucasCls).distinct().evaluate(function(cls) {

      // Update the lucas picker with the given list of cls.
      app.lucas.select.items().reset(cls);
      // Default the lucas picker to the first cls.
      app.lucas.select.setValue(app.lucas.select.items().get(0));

    });
    
    var filtered = ee.ImageCollection(app.COLLECTION_ID);
    // Filter bounds to the map center.
    filtered = filtered.filterBounds(Map.getCenter());
    // Apply cloud filter to get less cloudy granules.
    if (app.filters.cloudFilter.getValue()) {
      var cloud_percent = app.filters.cloudFilter.getValue() * 100;
      filtered = filtered.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',cloud_percent));
    }

    // Set filter variables.
    var start = app.filters.startDate.getValue();
    if (start) start = ee.Date(start);
    var end = app.filters.endDate.getValue();
    if (end) end = ee.Date(end);
    if (start) filtered = filtered.filterDate(start, end);

    // Get the list of computed ids.
    var computedIds = filtered
        .limit(app.IMAGE_COUNT_LIMIT)
        .reduceColumns(ee.Reducer.toList(), ['system:index'])
        .get('list');

    // Get the date and format it
    var computedDates = ee.List(computedIds)
      .map(function(id){
        var date = ee.String(id).split('_').get(0);
        // Replace "T" by space
        var good_date = ee.String(date).replace("T"," ");
        var eedate = ee.Date.parse('YYYYMMdd HHmmss', good_date);
        return eedate.format('YYYY/MM/dd HH:mm:ss');
      });
    
    computedDates.evaluate(function(dates) {
      // Update the image picker with the given list of ids.
      app.setLoadingMode(false);
      app.picker.select.items().reset(dates);
      // Default the image picker to the first id.
      app.picker.select.setValue(app.picker.select.items().get(0));
    });
    
  };
  
  /** Refreshes the current map layer based on the UI widget states. */
  app.refreshMapLayer = function() {
    
    Map.clear();
    
    var imageDate = app.picker.select.getValue();
    
    if (imageDate) {

      // Construct the date that image holds in the start of its ID
      var parsedImgDate = ee.Date.parse('YYYY/MM/dd HH:mm:ss', imageDate)

      var strDate = parsedImgDate.format('YYYYMMdd');
      var strTime = parsedImgDate.format('HHmmss');
      var idStarts = ee.String(strDate).cat('T').cat(strTime)
      
      // If an image date is found, filter again the collection.
      var image = ee.ImageCollection(app.COLLECTION_ID)
          .filterBounds(Map.getCenter())
          .filter(ee.Filter.stringStartsWith('system:index', idStarts))
          .first();
          
      // Apply cloud mask
      if (app.filters.cloudMask.getValue()) {
        image = ee.Image(maskS2clouds(image));
      }
      
      // Apply scalying factor
      image = ee.Image(scaleFactor(image));
      
      // Add the image to the map with the corresponding visualization options.
      var visOption = app.VIS_OPTIONS[app.vis.select.getValue()];
      if (app.vis.gammaFilter.getValue()){
        var gamma_value = app.vis.gammaFilter.getValue();
        visOption.visParams.gamma = gamma_value;
      }
      
      if (app.picker.highPass.getValue()){
        // Define a Laplacian, or edge-detection kernel.
        var laplacian = ee.Kernel.laplacian8({ normalize: false });
        visOption.visParams.max = 0.5
        // Apply the edge-detection kernel.
        image = image.convolve(laplacian);
      }
      
      Map.addLayer(image, visOption.visParams, imageDate);
    }
    
    var lucasId = app.lucas.select.getValue();
    if (lucasId) {
      Map.addLayer(LUCAS.filter(ee.Filter.eq('LC_LABEL', lucasId)), {}, 'BBDD LUCAS (2018)');
    } else {
      Map.addLayer(LUCAS, {}, 'BBDD LUCAS (2018)');
    }
    // if (app.picker.insertPAN.getValue()){
      // Map.addLayer(basemap, {min: 0.0, max: 0.4}, 'L9 Pan (15m) Enero 2022');
    // }

    // Set the default map's cursor to a "crosshair".
    Map.style().set('cursor', 'crosshair');
    
    /** Applies the selection filters currently selected in the UI. */
    // Create an inspector panel with a horizontal layout.
    var inspector = ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {position: 'bottom-right'}
    });
    
    // Add a label to the panel.
    inspector.add(ui.Label('Marca un punto para ver la firma espectral/NDVI'));
    
    // Add the panel to the default map.
    Map.add(inspector);
    
    // Register a click handler for the map that gets the clicked point
    // and the LUCAS point (if there is)
    function handleMapClick(location){

      // Create location object
      var p = ee.Geometry.Point([location.lon,location.lat]);
      var p_buffer = p.buffer(500);
      
      // Check LUCAS' point properties (if any is selected)
      var selected_lucas = LUCAS.filterBounds(p_buffer); 
      print(selected_lucas);
      selected_lucas.first().evaluate(function(feature){
        if (feature){
          inspector.widgets().set(2, feature.get("LC_LABEL"));
        }
      })
      // TODO: Check if there is an image data in the point coordinates
      // p.intersects(image.geometry())
      // Problem: The result of above code is not valid in client-side 
      
      inspector.clear();
      // var dot = ui.Map.Layer(p, {color: 'FFFFFF'}, 'clicked location');
      // // Add the dot as the second layer, so it shows up on top of the composite.
      // ui.Map().layers().set(2, dot);
      // var dot = Map.addLayer(p, {color: 'FFFFFF'}, 'clicked location');
      
      if (app.vis.ndvi.getValue()){
        
        
        var col = ee.ImageCollection(app.COLLECTION_ID).filterBounds(p); 
        
        var getNDVI = function(img){
          return img.normalizedDifference(['B8','B4']).copyProperties(img, ['system:time_start']);
        };
        /*
        // TODO: Compute one NDV every 3 months
        var ndviForYear = function(year) {
          var startDate = ee.Date.fromYMD(year, 1, 1);
          
          var make_datelist = function (n) {
            return startDate.advance(n, "month");
          };
          
          // have start date of every month
          var months = ee.List.sequence(1,12,3).map(make_datelist); 
        
          var computeNDVImonthly = function (d1) {
            var start = ee.Date(d1);
            var end = start.advance(3, "month");
            var date_range = ee.DateRange(start, end);
            var col_f = col.filterDate(date_range).reduce(ee.Reducer.mean());
            return ee.Image(getNDVI(col_f));
          };
          
          return months.map(computeNDVImonthly);
        };
        var ndvi = ee.ImageCollection(ee.List.sequence(2018, 2023).map(ndviForYear).flatten());
        var ndviChart = ui.Chart.image.series(
          ndvi,
          p, ee.Reducer.mean(), 20);
        */
        var ndvi = col.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',10)).map(maskS2clouds).map(getNDVI);
        
        var ndviChart = ui.Chart.image.doySeriesByYear({
          imageCollection: ndvi, 
          bandName: 'nd',  
          region: p,
          regionReducer: ee.Reducer.mean(), 
          scale: 70,
          sameDayReducer: ee.Reducer.mean()
        });
        ndviChart.setChartType('LineChart');
        ndviChart.setOptions({
          title: 'Serie de NDVI',
          // vAxis: {title: 'NDVI'}
        });

        inspector.widgets().set(2,ndviChart);
        
      } else {
        
        var wavelengths = ['494','560','665','704','740','780','835','864','945','1612','2200']
        // Make a chart from the time series.
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
            // viewWindow: {min: 0, max: 1}
          },
          hAxis: {title: 'nm'}
        });
        inspector.widgets().set(2,wChart);
      }
      
      // // Add a button to hide the Panel.
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

/** Creates the app constants. */
app.createConstants = function() {
  app.COLLECTION_ID = 'COPERNICUS/S2_SR_HARMONIZED';
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

/** Creates the application interface. */
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
      // app.export.panel
    ],
    style: {width: '320px', padding: '8px'}
  });
  Map.setCenter(-0.76, 41.11, 9);
  ui.root.insert(0, main);
  app.applyFilters();
};

app.boot();



