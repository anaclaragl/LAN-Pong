// Multi-Layer Perceptron (MLP) in pure JavaScript
// Zero external dependencies. Supports forward inference, backpropagation with Adam, and neuroevolution mutation.

export class MLP {
  constructor(layerSizes = [8, 24, 24, 2], weightsData = null) {
    this.layerSizes = layerSizes; // [input, hidden1, hidden2, output]
    this.weights = []; // weights[l][j][i]: weight from neuron i in layer l to neuron j in layer l+1
    this.biases = [];  // biases[l][j]: bias for neuron j in layer l+1

    // Adam optimizer moments
    this.mWeights = [];
    this.vWeights = [];
    this.mBiases = [];
    this.vBiases = [];
    this.beta1 = 0.9;
    this.beta2 = 0.999;
    this.eps = 1e-8;
    this.t = 0;

    if (weightsData) {
      this.fromJSON(weightsData);
    } else {
      this.initRandomWeights();
    }
    this.initAdamMoments();
  }

  initRandomWeights() {
    this.weights = [];
    this.biases = [];

    for (let l = 0; l < this.layerSizes.length - 1; l++) {
      const inSize = this.layerSizes[l];
      const outSize = this.layerSizes[l + 1];

      // Xavier / Glorot initialization: std = sqrt(2 / (inSize + outSize))
      const scale = Math.sqrt(2 / (inSize + outSize));

      const layerWeights = [];
      const layerBiases = [];

      for (let j = 0; j < outSize; j++) {
        const row = [];
        for (let i = 0; i < inSize; i++) {
          row.push((Math.random() * 2 - 1) * scale);
        }
        layerWeights.push(row);
        layerBiases.push(0.0);
      }

      this.weights.push(layerWeights);
      this.biases.push(layerBiases);
    }
  }

  initAdamMoments() {
    this.mWeights = [];
    this.vWeights = [];
    this.mBiases = [];
    this.vBiases = [];

    for (let l = 0; l < this.weights.length; l++) {
      const outSize = this.layerSizes[l + 1];
      const inSize = this.layerSizes[l];

      const mW = [];
      const vW = [];
      for (let j = 0; j < outSize; j++) {
        mW.push(new Array(inSize).fill(0));
        vW.push(new Array(inSize).fill(0));
      }
      this.mWeights.push(mW);
      this.vWeights.push(vW);

      this.mBiases.push(new Array(outSize).fill(0));
      this.vBiases.push(new Array(outSize).fill(0));
    }
  }

  // Forward pass
  // returns activations array for each layer (index 0 is input, last is output)
  forward(inputs) {
    let current = inputs;
    for (let l = 0; l < this.weights.length; l++) {
      const next = [];
      const wLayer = this.weights[l];
      const bLayer = this.biases[l];

      for (let j = 0; j < wLayer.length; j++) {
        let sum = bLayer[j];
        const row = wLayer[j];
        for (let i = 0; i < current.length; i++) {
          sum += row[i] * current[i];
        }
        // tanh activation
        next.push(Math.tanh(sum));
      }
      current = next;
    }
    return current;
  }

  // Forward pass returning all intermediate layer outputs (used for backpropagation)
  forwardAll(inputs) {
    const activations = [inputs];
    let current = inputs;

    for (let l = 0; l < this.weights.length; l++) {
      const next = [];
      const wLayer = this.weights[l];
      const bLayer = this.biases[l];

      for (let j = 0; j < wLayer.length; j++) {
        let sum = bLayer[j];
        const row = wLayer[j];
        for (let i = 0; i < current.length; i++) {
          sum += row[i] * current[i];
        }
        next.push(Math.tanh(sum));
      }
      activations.push(next);
      current = next;
    }
    return activations;
  }

  // Backpropagation step on a single training example or accumulated gradients using Adam
  trainSample(inputs, targets, learningRate = 0.005, mask = null) {
    this.t += 1;
    const activations = this.forwardAll(inputs);
    const numLayers = this.weights.length;

    // Delta for output layer
    // Loss = 0.5 * (out - target)^2
    // dLoss/dOut = out - target
    // dOut/dZ = 1 - out^2 (derivative of tanh)
    let deltas = [];
    const lastLayerIdx = numLayers;
    const output = activations[lastLayerIdx];
    for (let j = 0; j < output.length; j++) {
      const m = mask ? mask[j] : 1;
      const error = (output[j] - targets[j]) * m;
      const dtanh = 1 - output[j] * output[j];
      deltas.push(error * dtanh);
    }

    // Backpropagate through hidden layers
    for (let l = numLayers - 1; l >= 0; l--) {
      const prevActivations = activations[l];
      const curWeights = this.weights[l];
      const nextDeltas = [];

      if (l > 0) {
        for (let i = 0; i < prevActivations.length; i++) {
          let errSum = 0;
          for (let j = 0; j < deltas.length; j++) {
            errSum += curWeights[j][i] * deltas[j];
          }
          const dtanh = 1 - prevActivations[i] * prevActivations[i];
          nextDeltas.push(errSum * dtanh);
        }
      }

      // Update weights and biases with Adam
      const b1 = this.beta1;
      const b2 = this.beta2;
      const eps = this.eps;
      const t = this.t;

      const alpha = learningRate * Math.sqrt(1 - Math.pow(b2, t)) / (1 - Math.pow(b1, t));

      for (let j = 0; j < deltas.length; j++) {
        const d_j = deltas[j];

        // Biases
        this.mBiases[l][j] = b1 * this.mBiases[l][j] + (1 - b1) * d_j;
        this.vBiases[l][j] = b2 * this.vBiases[l][j] + (1 - b2) * (d_j * d_j);
        this.biases[l][j] -= alpha * this.mBiases[l][j] / (Math.sqrt(this.vBiases[l][j]) + eps);

        // Weights
        for (let i = 0; i < prevActivations.length; i++) {
          const grad = d_j * prevActivations[i];
          this.mWeights[l][j][i] = b1 * this.mWeights[l][j][i] + (1 - b1) * grad;
          this.vWeights[l][j][i] = b2 * this.vWeights[l][j][i] + (1 - b2) * (grad * grad);
          this.weights[l][j][i] -= alpha * this.mWeights[l][j][i] / (Math.sqrt(this.vWeights[l][j][i]) + eps);
        }
      }

      deltas = nextDeltas;
    }
  }

  // Create an exact clone of this network
  clone() {
    const cloned = new MLP(this.layerSizes);
    cloned.weights = JSON.parse(JSON.stringify(this.weights));
    cloned.biases = JSON.parse(JSON.stringify(this.biases));
    return cloned;
  }

  // Mutate weights for genetic evolution
  mutate(mutationRate = 0.08, mutationScale = 0.05) {
    for (let l = 0; l < this.weights.length; l++) {
      for (let j = 0; j < this.weights[l].length; j++) {
        if (Math.random() < mutationRate) {
          this.biases[l][j] += (Math.random() * 2 - 1) * mutationScale;
        }
        for (let i = 0; i < this.weights[l][j].length; i++) {
          if (Math.random() < mutationRate) {
            this.weights[l][j][i] += (Math.random() * 2 - 1) * mutationScale;
          }
        }
      }
    }
  }

  toJSON() {
    return {
      layerSizes: this.layerSizes,
      weights: this.weights,
      biases: this.biases,
    };
  }

  fromJSON(data) {
    this.layerSizes = data.layerSizes || [8, 24, 24, 2];
    this.weights = data.weights;
    this.biases = data.biases;
    this.initAdamMoments();
  }
}
