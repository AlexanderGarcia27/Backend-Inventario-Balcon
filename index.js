const express = require("express");
const cors = require("cors");
const { db } = require("./firebase");

const app = express();
app.use(cors());
app.use(express.json());

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

// Crear producto(s) - Acepta un objeto simple O un array de objetos
app.post("/productos", async (req, res) => {
  try {
    const productosParaGuardar = Array.isArray(req.body) ? req.body : [req.body];
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

    for (const producto of productosParaGuardar) {
      if (!producto || !producto.nombre) {
        productosOmitidos++;
        continue;
      }

      ultimoNumero++;
      const nuevoCodigo = "P" + ultimoNumero.toString().padStart(3, "0");

      const nuevoProducto = {
        nombre: producto.nombre,
        precio: Number(producto.precio) || 0,
        precioCompra: Number(producto.precioCompra) || 0,
        categoria: producto.categoria || 'Sin Categoría',
        stock: Number(producto.stock) || 0,
        codigo: nuevoCodigo,
        creadoEn: new Date()
      };

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
app.get("/productos", async (req, res) => {
  try {
    const snapshot = await db.collection("productos").get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    lista.sort((a, b) => {
      const numA = parseInt(a.codigo.replace("P", ""));
      const numB = parseInt(b.codigo.replace("P", ""));
      return numA - numB;
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar producto
app.put("/productos/:id", async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (updateData.precio !== undefined) {
      updateData.precio = Number(updateData.precio) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = Number(updateData.stock) || 0;
    }
    if (updateData.precioCompra !== undefined) {
      updateData.precioCompra = Number(updateData.precioCompra) || 0;
    }

    await db.collection("productos").doc(req.params.id).update(updateData);
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
// GESTIÓN DE DATOS PELIGROSA (BORRADO TOTAL)
// ----------------------------------------------

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snapshot.size;
}

app.delete("/administracion/borrar-todo-peligro", async (req, res) => {
  try {
    console.log("INICIANDO BORRADO TOTAL DE DATOS...");
    const productosBorrados = await deleteCollection("productos");
    const ventasBoradas = await deleteCollection("ventas");
    console.log("BORRADO TOTAL FINALIZADO.");

    res.json({
      mensaje: "PELIGRO! Todas las colecciones han sido vaciadas.",
      detalle: {
        productos_eliminados: productosBorrados,
        ventas_eliminadas: ventasBoradas,
      },
    });
  } catch (error) {
    console.error("Error en el borrado total:", error);
    res.status(500).json({ error: "Error fatal al intentar borrar colecciones" });
  }
});

// ----------------------------------------------
// VENTAS
// ----------------------------------------------

// Crear una venta (Guarda costoVenta)
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

    // Cálculo de Costo y Ganancia
    const precioCompraUnidad = producto.precioCompra || 0;
    const costoMercanciaVendida = precioCompraUnidad * cantidad;

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
      cantidad: Number(cantidad),
      total: Number(total),
      monto: Number(monto),
      cambio: Number(cambio),
      costoVenta: costoMercanciaVendida, // CRUCIAL: Guardamos el costo
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

// Obtener todas las ventas con datos del producto (Optimizado y calcula Ganancia)
app.get("/ventas", async (req, res) => {
  try {
    // Total de lecturas: 1
    const ventasSnapshot = await db.collection("ventas").get();

    // Total de lecturas: 2 (Obtenemos todos los productos de golpe)
    const productosSnapshot = await db.collection("productos").get();
    const productosMap = {};
    productosSnapshot.docs.forEach(doc => {
      productosMap[doc.id] = doc.data();
    });

    const ventas = [];

    for (const doc of ventasSnapshot.docs) {
      const venta = doc.data();
      venta.id = doc.id;

      // Calcular la ganancia
      const costoVenta = venta.costoVenta || 0;
      venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

      // Obtener datos del producto usando el mapa (0 lecturas adicionales)
      const producto = productosMap[venta.productoId];

      if (producto) {
        venta.productoNombre = producto.nombre;
        venta.productoCodigo = producto.codigo;
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

// Obtener una venta específica (Calcula Ganancia)
app.get("/ventas/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const ventaSnapshot = await db.collection("ventas").doc(id).get();

    if (!ventaSnapshot.exists) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    const venta = ventaSnapshot.data();

    // Calcular la ganancia
    const costoVenta = venta.costoVenta || 0;
    venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

    return res.json(venta);
  } catch (error) {
    console.error("Error al obtener la venta:", error);
    return res.status(500).json({ error: "Error al obtener la venta" });
  }
});


// ----------------------
const PORT = 3000;
app.listen(PORT, () => console.log("API lista en puerto", PORT));

// ------------------------------
// LOGIN y DASHBOARD
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

app.get("/dashboard/totales", async (req, res) => {
  try {
    const productosSnapshot = await db.collection("productos").get();
    const totalProductos = productosSnapshot.size;

    const productosStockBajo = productosSnapshot.docs.filter(
      doc => doc.data().stock < 10
    ).length;

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