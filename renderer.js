// This file is required by the index.html file and will
// be executed in the renderer process for that window.
// All of the Node.js APIs are available in this process.
let $ = require('jquery');
let _ = require('lodash');
let fs = require('fs');
let http = require('http');
let path = require('path');
let globalId = 0;
let sourceImages = [];
let outputFolder = null;
let styleId = null;

// read from styles folder
// set style image options
fs.readdir(path.join(__dirname, 'style-images'), function(err, imageNames) {
  imageNames.forEach(function(imageName) {
    let styleName = getStyleName(imageName);

    let imageData = readImageAsDataUrl(path.join(__dirname, 'style-images', imageName));

    let preview = $(`
      <img class="style-image" src="data:image/png;base64,${imageData}" />
    `);

    preview.click(function() {
      $('#style-image-previews img').removeClass('selected');
      $(this).addClass('selected');

      styleId = styleName;
    });

    $('#style-image-previews').append(preview);
  });
});

function readImageAsDataUrl(file) {
  // read binary data
  var bitmap = fs.readFileSync(file);

  // convert binary data to base64 encoded string
  return new Buffer(bitmap).toString('base64');
}

$('#source-images').change(function() {
  files = this.files;
  sourceImages = [];

  for (let file of files) {
    sourceImages.push({
      id: ++globalId,
      file: file,
      name: file.name,
      status: 'PENDING',
      artId: null,
      url: null,
      path: null
    });
  }
});

$('#output-folder').change(function() {
  if (this.files.length > 0) {
    outputFolder = this.files[0].path;
  }
});

$('#builder-go').click(function(event) {
  event.preventDefault();

  clearErrors();

  let hasError = false;

  if (sourceImages.length === 0) {
    hasError = true;
    addError('Please Choose your Source Images');
  }

  if (outputFolder === null) {
    hasError = true;
    addError('Please Choose your Output Folder');
  }

  if (styleId === null) {
    hasError = true;
    addError('Please Select a Style Image');
  }

  if (!hasError) {
    showArtFiles();

    // scroll to arts
    $('html, body').animate({
      scrollTop: $("#arts").offset().top
    }, 2000);

    processImages(sourceImages);
  }
});

function clearErrors() {
  $('#errors').empty();
}

function addError(error) {
  $('#errors').append('<li class="error">' + error + '</li>');
}

function processImages(images) {
  if (images.length > 0) {
    processImage(_.head(images)).
      then(() => {
        processImages(_.tail(images))
      });
  }
}

function processImage(image) {
  image.status = 'UPLOADING';
  refreshArtFile(image);

  return (
    uploadFile(imageUploadUrl(), image.file).
      then(response => {
        image.status = 'RENDERING';
        refreshArtFile(image);

        const result = JSON.parse(response);
        const mixingLevel = $('#mixing-level').val();

        return createArtJob(
          createArtJobUrl(),
          styleId,
          mixingLevel,
          result.imgId
        );
      }).
      then(response => {
        const jobId = response.jobId;

        image.artId = jobId;
        refreshArtFile(image);

        return waitForJob(queryArtJobUrl(jobId));
      }).
      then(response => {
        image.url = response.outputUrls[0];
        image.status = 'DOWNLOADING';
        refreshArtFile(image);

        return downloadArt(
          outputUrl(response.outputIds[0]),
          outputPath(image.name)
        );
      }).
      then(() => {
        image.status = 'DONE';
        image.path = outputPath(image.name);

        refreshArtFile(image);
      }).
      catch(failure => {
        console.log(failure);

        if (failure.message) {
          $('#errors').html(failure.message);
        } else {
          $('#errors').html(failure);
        }
      })
  );
}

function waitForJob(url) {
  return new Promise(function(resolve, reject) {
    const check = setInterval(function() {
      $.ajax({
        url: url,
        dataType: 'json'
      }).done(function(job) {
        if (job.status === 'finished') {
          clearInterval(check);

          resolve(job);
        }
      }).fail(function(job) {
        clearInterval(check);

        reject('wait for job failed');
      });
    }, 3000);
  });
}

function downloadArt(url, path) {
  return new Promise(function(resolve, reject) {
    let file = fs.createWriteStream(path);

    let request = http.get(url, function(response) {
      response.pipe(file);

      response.on('end', resolve);
    }).on('error', reject);
  });
}

function createArtJob(url, styleId, mixingLevel, imageId) {
  return new Promise(function(resolve, reject) {
    $.ajax({
      type: 'POST',
      url: url,
      data: JSON.stringify({
        imgId: imageId,
        styles: [
          { id: styleId, mixingLevel: mixingLevel }
        ]
      }),
      dataType: 'json'
    }).done(resolve).fail(reject);
  });
}

$('#builder-cancel').click(function(event) {
  event.preventDefault();

  hideArtFiles();
});

function refreshArtFile(image) {
  $('#image-' + image.id).html(`
    <td>${image.name}</td>
    <td>${image.status}</td>
    <td>${image.artId}</td>
    <td>${image.url}</td>
    <td>${image.path}</td>
  `);
}

function showArtFiles() {
  for (let image of sourceImages) {
      $('#arts tbody').append(`
        <tr id="image-${image.id}">
          <td>${image.name}</td>
          <td>${image.status}</td>
          <td>${image.artId}</td>
          <td>${image.url}</td>
          <td>${image.path}</td>
        </tr>
      `);
  }

  $('#built').show();
}

function hideArtFiles() {
  $('#built').hide();
  $('#arts tbody').empty();
}

function uploadFile(url, file) {
  return new Promise(function(resolve, reject) {
    let xhr = new XMLHttpRequest();

    xhr.open('POST', url, true);

    xhr.onreadystatechange = function() {
      if (xhr.readyState == 4 && xhr.status == 200) {
        resolve(xhr.responseText);
      }
    };

    let fd = new FormData();

    fd.append('image', file);

    xhr.send(fd);
  });
}

function getStyleName(imageFileName) {
  return (
    imageFileName.substring(
      0,
      imageFileName.indexOf('.')
    )
  );
}

function imageUploadUrl() {
  let instanceUrl = $('#instance-url').val();

  return instanceUrl + '/api/v1/image';
}

function createArtJobUrl() {
  let instanceUrl = $('#instance-url').val();

  return instanceUrl + '/api/v1/art/';
}

function queryArtJobUrl(id) {
  let instanceUrl = $('#instance-url').val();

  return instanceUrl + '/api/v1/art/' + id;
}

function outputUrl(id) {
  let instanceUrl = $('#instance-url').val();

  return instanceUrl + '/api/v1/art/output/' + id;
}

function outputPath(filename) {
  return path.join(outputFolder, filename);
}
