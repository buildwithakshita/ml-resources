// Two brains trained ahead of time with this exact code.
// Scores are laps finished on 40 random roads neither brain had ever seen.

// Trained on the city block only. It memorised that road: great at home, lost on new roads.
export const PRETRAINED_ONE_ROAD = {"weights":[[[0.4439,1.7109,-0.3586,0.7998,-0.2058],[-0.7643,7.2202,-3.3834,1.3765,-4.4752],[3.4282,2.7868,-0.6096,-1.2839,-0.1143],[-2.548,-0.4757,0.1653,0.2316,0.3997],[4.3556,-3.7349,-1.8137,5.9511,-2.9328],[4.077,-1.5661,0.2117,1.4947,-0.9808]],[[-0.9186,2.1715,2.2672,-0.2413,-4.2369,-2.115],[1.0869,2.7509,0.9391,-1.2089,2.6341,-0.7305]]],"biases":[[-1.9898,2.3367,3.0745,0.1383,1.1052,0.9559],[3.275,-0.1695]]};
export const ONE_ROAD_INFO = { generations: 45, newRoads: 11, tested: 40 };

// Trained on a different random road every generation (60 generations). It learned to drive, not one road.
export const PRETRAINED = {"weights":[[[-1.7251,-0.8473,1.0128,1.9902,2.1842],[1.6414,3.0646,2.7495,4.5034,-5.346],[-3.9741,1.8759,-4.2299,2.7359,-2.0889],[2.1536,-2.1405,-2.2723,-0.9335,0.5938],[-0.3704,5.2802,0.7512,-4.7806,-0.2786],[4.0802,-3.67,-7.7646,-4.2342,3.9119]],[[-1.205,-0.3744,-3.9705,-1.4642,4.5132,-0.7676],[-0.7179,3.6369,1.7459,4.8243,-2.1712,-1.5525]]],"biases":[[-0.277,5.067,-0.4485,0.5739,2.0172,-1.3368],[-0.7541,-0.1039]]};
export const PRETRAINED_INFO = { generations: 60, newRoads: 40, tested: 40 };
