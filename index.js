const express = require("express");
const cors = require("cors");
const { db } = require("./firebase");

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// GENERAR CODIGO PRODUCTO
// ----------------------
async function generarCodigoProducto() {
  const productos = await db.collection("productos").get();
  const total = productos.size + 1;
  return "P" + String(total).padStart(3, "0");
}

// ----------------------
// GENERAR CODIGO VENTA
// ----------------------
async function generarCodigoVenta() {
  const ventas = await db.collection("ventas").get();
  const total = ventas.size + 1;
  return "V" + String(total).padStart(3, "0");
}

// ----------------------------------------------
// CRUD PRODUCTOS
// ----------------------------------------------

// ----------------------------------------------
// CRUD PRODUCTOS (VERSION MEJORADA PARA LOTES)
// ----------------------------------------------

// Crear producto(s) - Acepta un objeto simple O un array de objetos
app.post("/productos", async (req, res) => {
  try {
    // 1. Determinar si es un solo producto o una lista (array)
    const productosParaGuardar = Array.isArray(req.body) ? req.body : [req.body];

    // 2. Obtener el último número de código UNA SOLA VEZ
    const snapshot = await db.collection("productos").get();
    let ultimoNumero = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.codigo) {
        const num = parseInt(data.codigo.replace("P", ""));
        if (num > ultimoNumero) ultimoNumero = num;
      }
    });

    const productosAgregados = [];
    let productosOmitidos = 0;

    // 3. Iterar sobre la lista de productos
    for (const producto of productosParaGuardar) {
      // CRÍTICO: FILTRAR PRODUCTOS INVÁLIDOS (LÍNEAS VACÍAS DEL CSV)
      if (!producto || !producto.nombre) {
        productosOmitidos++;
        continue; // Saltar al siguiente producto si no tiene nombre
      }

      // 4. Generar el nuevo código de forma incremental
      ultimoNumero++;
      const nuevoCodigo = "P" + ultimoNumero.toString().padStart(3, "0");

      // 5. Crear el nuevo producto (asegurando valores por defecto)
      const nuevoProducto = {
        nombre: producto.nombre,
        // Los valores ausentes ahora serán 0 o 'Sin Categoría', no undefined
        precio: Number(producto.precio) || 0,
        categoria: producto.categoria || 'Sin Categoría',
        stock: Number(producto.stock) || 0,
        codigo: nuevoCodigo,
        creadoEn: new Date()
      };

      // 6. Guardar en Firestore
      const productoRef = await db.collection("productos").add(nuevoProducto);

      productosAgregados.push({
        id: productoRef.id,
        nombre: nuevoProducto.nombre,
        codigo: nuevoCodigo
      });
    }

    if (productosAgregados.length === 0) {
      return res.status(400).json({ error: "No se encontró ningún producto válido para agregar." });
    }

    res.json({
      mensaje: "Productos agregados correctamente.",
      total_agregados: productosAgregados.length,
      total_omitidos: productosOmitidos,
      productos: productosAgregados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos" });
  }
});


// Listar productos
// Listar productos en orden por código
app.get("/productos", async (req, res) => {
  try {
    const snapshot = await db.collection("productos").get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Ordenar por el número dentro del código: P001 → 1, P087 → 87, etc.
    lista.sort((a, b) => {
      const numA = parseInt(a.codigo.replace("P", ""));
      const numB = parseInt(b.codigo.replace("P", ""));
      return numA - numB; // orden ascendente
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// Actualizar producto
app.put("/productos/:id", async (req, res) => {
  try {
    await db.collection("productos").doc(req.params.id).update(req.body);
    res.json({ mensaje: "Producto actualizado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar producto
app.delete("/productos/:id", async (req, res) => {
  try {
    await db.collection("productos").doc(req.params.id).delete();
    res.json({ mensaje: "Producto eliminado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------
// VENTAS
// ----------------------------------------------

// Crear una venta
app.post("/ventas", async (req, res) => {
  try {
    const { productoId, cantidad, total, monto, cambio, nota } = req.body;

    if (!productoId || !cantidad || !total || !monto) {
      return res.status(400).json({ error: "Faltan datos obligatorios" });
    }

    // Obtener producto
    const productoRef = db.collection("productos").doc(productoId);
    const productoDoc = await productoRef.get();

    if (!productoDoc.exists) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    const producto = productoDoc.data();

    // Validar stock
    if (producto.stock < cantidad) {
      return res.status(400).json({ error: "Stock insuficiente" });
    }

    // Descontar stock
    await productoRef.update({
      stock: producto.stock - cantidad
    });

    // Generar código de venta V00X
    const codigoVenta = await generarCodigoVenta();

    // Crear objeto de venta
    const ventaData = {
      codigo: codigoVenta,
      productoId,
      cantidad,
      total,
      monto,
      cambio,
      nota: nota || "",
      fecha: new Date()
    };

    // Guardar venta
    const ventaRef = await db.collection("ventas").add(ventaData);

    res.json({
      mensaje: "Venta registrada correctamente",
      id: ventaRef.id,
      venta: ventaData
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});



// Obtener todas las ventas con datos del producto
app.get("/ventas", async (req, res) => {
  try {
    const ventasSnapshot = await db.collection("ventas").get();
    const ventas = [];

    for (const doc of ventasSnapshot.docs) {
      const venta = doc.data();
      venta.id = doc.id;

      // Obtener datos del producto
      const productoRef = db.collection("productos").doc(venta.productoId);
      const productoDoc = await productoRef.get();

      if (productoDoc.exists) {
        const producto = productoDoc.data();
        venta.productoNombre = producto.nombre;
        venta.productoCodigo = producto.codigo; // P001, P002, etc.
      } else {
        venta.productoNombre = "Producto eliminado";
        venta.productoCodigo = "-";
      }

      ventas.push(venta);
    }

    res.json(ventas);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// ----------------------
const PORT = 3000;
app.listen(PORT, () => console.log("API lista en puerto", PORT));

// Obtener una venta específica
app.get("/ventas/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const ventaSnapshot = await db.collection("ventas").doc(id).get();

    if (!ventaSnapshot.exists) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    return res.json(ventaSnapshot.data());
  } catch (error) {
    console.error("Error al obtener la venta:", error);
    return res.status(500).json({ error: "Error al obtener la venta" });
  }
});

// ------------------------------
// LOGIN
// ------------------------------

app.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const ref = db.collection('usuarios');
    const query = await ref.where("usuario", "==", usuario).get();

    if (query.empty) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const userDoc = query.docs[0].data();

    if (userDoc.password !== password) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    return res.json({ mensaje: "Inicio de sesión exitoso" });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});


// Obtener total de productos, productos con bajo stock y ventas últimos 7 días
app.get("/dashboard/totales", async (req, res) => {
  try {
    // 1. Total de productos
    const productosSnapshot = await db.collection("productos").get();
    const totalProductos = productosSnapshot.size;

    // 2. Productos con stock bajo (< 10)
    const productosStockBajo = productosSnapshot.docs.filter(
      doc => doc.data().stock < 10
    ).length;

    // 3. Total de ventas últimas 7 días
    const hoy = new Date();
    const hace7dias = new Date();
    hace7dias.setDate(hoy.getDate() - 7);

    const ventasSnapshot = await db.collection("ventas").get();

    let ventasUltimos7Dias = 0;

    ventasSnapshot.forEach(doc => {
      const venta = doc.data();
      const fechaVenta = new Date(venta.fecha.toDate());

      if (fechaVenta >= hace7dias) {
        ventasUltimos7Dias += venta.total;
      }
    });

    res.json({
      totalProductos,
      productosStockBajo,
      ventasUltimos7Dias
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
